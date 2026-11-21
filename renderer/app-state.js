const appState = {
  launchOptions: { profileName: null, autotestMode: null },
  myName: savedPreferences.read('name', ''),
  shareSettings: normalizeShareSettings(savedPreferences.read('shareSettings', {})),
  networkInfo: null,
  discoveredRooms: [],
  roomConnection: null,
  roomDetails: null,
  myParticipantId: null,
  participantsById: new Map(),
  hostedRoom: null,
  myBroadcast: null,
  watchedStreamsByBroadcasterId: new Map(),
  focusedBroadcasterId: null,
};

function showScreen(screenName) {
  findElement('#lobby-screen').classList.toggle('hidden', screenName !== 'lobby');
  findElement('#room-screen').classList.toggle('hidden', screenName !== 'room');
}
