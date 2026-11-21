# Telinha

Compartilhamento de tela entre amigos pela rede do Radmin VPN, parecido com o "Ao vivo" do Discord.

- Quem cria a sala vira o host. O servidor da sala roda dentro do app dele.
- Todo mundo pode compartilhar ao mesmo tempo, e cada um escolhe quem quer assistir.
- Compartilha o monitor inteiro (escolhendo qual) ou só uma janela.
- Áudio opcional:
  - **Tela inteira:** o som de cada programa aberto, menos o do próprio Telinha (assim não dá eco de quem você está assistindo).
    Por padrão também fica de fora o **Discord**: a voz da call não vaza pra transmissão.
    Mixers virtuais (SteelSeries Sonar, Voicemeeter, Wave Link) são ignorados pra não duplicar o som.
  - **Janela:** só o som daquele programa.
- **Trocar ao vivo:** o botão **🔄 Trocar** muda o que está sendo transmitido (outra janela, outro monitor) sem parar a transmissão e sem ninguém precisar reconectar. O **⚙ Qualidade** muda resolução, fps e bitrate também ao vivo.
- Qualidade: 480p, 720p, 1080p ou Original; 15, 20 ou 30 fps (o máximo é 30); bitrate de 1 a 20 Mbps (o padrão é 1080p, 30 fps, 10 Mbps).
- A voz continua no Discord. O Telinha é só pra tela.

## Pra quem vai usar

1. Instale com o `Telinha-Instalador-<versão>.exe` (recomendado), ou use o `Telinha-Portatil-<versão>.exe`, que roda sem instalar.
   - O Windows pode mostrar "O Windows protegeu o computador". Clique em **Mais informações → Executar assim mesmo**. Esse aviso aparece porque o app não tem assinatura digital paga.
2. Entre na mesma rede do Radmin VPN que os amigos.
3. Abra o Telinha e coloque seu nome.
4. Se aparecer **"⚠ O Telinha ainda não foi liberado no firewall"**, clique em **Liberar** e confirme o aviso do Windows.
   - Por que isso importa: o Windows trata a rede do Radmin como **pública**. Se você clicou só em "Permitir" no aviso do firewall, o app fica bloqueado justamente no Radmin.
5. Um de vocês clica em **Criar sala**. Os outros veem a sala aparecer em "Salas na rede" e clicam em **Entrar**.
   - Se a sala não aparecer, dá pra entrar digitando o IP do Radmin do host (ele aparece no topo da tela do host).
6. Clique em **Compartilhar tela**, escolha o monitor ou a janela e clique em **🔴 Ao vivo**.
7. Pra assistir, clique em quem está **AO VIVO**. Dá pra assistir mais de uma pessoa ao mesmo tempo. Clique duas vezes no vídeo pra tela cheia.

**Atualizações:** quem instalou com o instalador recebe as versões novas sozinho. O app baixa em segundo plano e mostra **"Atualizar e reiniciar"** no topo. Quem usa o portátil vê um aviso com o botão **Baixar**. Na lista da sala, aparece a versão de quem estiver com uma diferente da sua.

### Se travar ou ficar ruim

- Olhe as estatísticas no canto do vídeo (Mbps e ping). Se o Mbps ficar travado bem abaixo do configurado, ou o painel de quem transmite mostrar **"limitado pela rede"**, o caminho entre vocês está apertado (upload fraco ou o Radmin passando pelos servidores dele). Abaixe pra 720p e uns 4 Mbps em **⚙ Qualidade**, sem precisar parar.
- Quem transmite manda uma cópia do vídeo pra cada pessoa assistindo. Com 5 pessoas a 10 Mbps, são 50 Mbps de upload. Em **Avançado → Upload máximo total**, o app divide o bitrate automaticamente pra caber nesse limite (o padrão é 30 Mbps).
- O painel de quem transmite avisa **"limitado pela rede"** ou **"limitado pela CPU"** quando é o caso.
- No modo janela, o áudio é do programa inteiro. No Chrome, por exemplo, sai o som de todas as abas.
- **Tela preta ou só um pedaço da imagem aparecendo ao assistir** (e os outros veem normal): desmarque **"Decodificar vídeo pela placa de vídeo"** no começo do app e reinicie. O vídeo passa a ser decodificado pelo processador, o que é leve em 1080p 30 fps.

## Pra quem desenvolve

Precisa de Node 20 ou mais novo e do .NET SDK (o auxiliar de áudio é compilado pra .NET Framework 4.8, que já vem no Windows 10 e 11).

```
npm install
npm run build:audio
npm start
```

| Comando | O que faz |
|---|---|
| `npm test` | roda todos os testes abaixo |
| `npm run test:server` | servidor da sala, senha, sinalização e descoberta na rede |
| `npm run test:audio` | captura por programa, tudo menos um programa e a mistura sem Discord (usa um tom inaudível de 22 kHz, detectado por frequência) |
| `npm run test:e2e` | abre duas instâncias: uma cria a sala e transmite, a outra entra e assiste |
| `npm run test:glitch` | troca a fonte ao vivo, muda a resolução, cobre a janela e mede tela preta e congelamentos |
| `npm run dist` | gera o instalador e o portátil em `release/<versão>/`, sem publicar |
| `npm run test:update` | gera uma versão falsa mais nova, serve por um servidor local e confere se o app baixa e oferece a atualização |
| `npm run release -- -Version 1.2.3` | muda a versão, faz commit e tag, envia pro GitHub e publica o instalador. Quem tem o Telinha instalado recebe o aviso de atualização |

### Organização

| Pasta | Conteúdo |
|---|---|
| `main.js`, `main-process/` | processo principal do Electron: janela, hospedagem da sala, fontes de captura, captador de áudio, firewall |
| `server/` | servidor da sala (WebSocket) e descoberta de salas (broadcast UDP) |
| `renderer/` | interface e WebRTC (quem transmite em `screen-broadcast.js`, quem assiste em `stream-viewer.js`) |
| `native/audiocap/` | captador de áudio em C# (WASAPI process loopback) |
| `test/` | testes automáticos |

Os testes usam a porta 47850 e não anunciam a sala na rede, então dá pra rodar com o Telinha aberto numa sala de verdade. Eles abrem janelas de teste na tela por alguns segundos.

Portas usadas: TCP 47800 (sala, dá pra mudar) e UDP 47801 (descoberta). O vídeo vai direto de um PC pro outro, por WebRTC.
