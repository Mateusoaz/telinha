const { app, ipcMain } = require('electron');
const { spawn } = require('child_process');

const FIREWALL_RULE_NAME = 'Telinha';

function registerFirewallHandlers() {
  ipcMain.handle('check-firewall', checkFirewallAccess);
  ipcMain.handle('allow-through-firewall', allowAppThroughFirewall);
}

function escapeForPowerShellString(text) {
  return text.replace(/'/g, "''");
}

function runPowerShellScript(script, { asAdministrator = false } = {}) {
  return new Promise((resolve) => {
    const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
    const powerShellArguments = asAdministrator
      ? ['-NoProfile', '-Command', `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encodedScript}'`]
      : ['-NoProfile', '-EncodedCommand', encodedScript];
    const powerShell = spawn('powershell.exe', powerShellArguments, { windowsHide: true });
    let output = '';
    let errorOutput = '';
    powerShell.stdout.on('data', (chunk) => { output += chunk; });
    powerShell.stderr.on('data', (chunk) => { errorOutput += chunk; });
    powerShell.on('exit', (exitCode) => resolve({ exitCode, output: output.trim(), errorOutput: errorOutput.trim() }));
    powerShell.on('error', (error) => resolve({ exitCode: -1, output: '', errorOutput: error.message }));
  });
}

function scriptToFindInboundRulesForThisApp() {
  const executablePath = escapeForPowerShellString(app.getPath('exe'));
  return `Get-NetFirewallApplicationFilter -Program '${executablePath}' -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue`;
}

async function checkFirewallAccess() {
  const result = await runPowerShellScript(`
    $rules = @(${scriptToFindInboundRulesForThisApp()} | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' })
    $blockingRules = @($rules | Where-Object { $_.Action -eq 'Block' }).Count
    $publicAllowRules = @($rules | Where-Object { $_.Action -eq 'Allow' -and ("$($_.Profile)" -match 'Public|Any') }).Count
    @{ blockingRules = $blockingRules; publicAllowRules = $publicAllowRules } | ConvertTo-Json -Compress`);
  try {
    const counts = JSON.parse(result.output);
    return { isAllowed: counts.blockingRules === 0 && counts.publicAllowRules > 0, isBlocked: counts.blockingRules > 0 };
  } catch {
    return { isAllowed: null, isBlocked: null };
  }
}

async function allowAppThroughFirewall() {
  const executablePath = escapeForPowerShellString(app.getPath('exe'));
  await runPowerShellScript(`
    ${scriptToFindInboundRulesForThisApp()} | Where-Object { $_.Action -eq 'Block' } | Remove-NetFirewallRule
    Remove-NetFirewallRule -DisplayName '${FIREWALL_RULE_NAME}' -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName '${FIREWALL_RULE_NAME}' -Direction Inbound -Program '${executablePath}' -Action Allow -Profile Any | Out-Null`,
  { asAdministrator: true });
  return checkFirewallAccess();
}

module.exports = { registerFirewallHandlers };
