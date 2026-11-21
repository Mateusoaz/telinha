const dgram = require('dgram');
const os = require('os');

const DISCOVERY_PORT = 47801;
const ANNOUNCEMENT_TAG = 'telinha/1';
const ANNOUNCE_INTERVAL_MS = 1500;
const ROOM_EXPIRATION_MS = 5000;
const EXPIRATION_CHECK_INTERVAL_MS = 1000;
const LOOPBACK_ADDRESS = '127.0.0.1';
const LIMITED_BROADCAST_ADDRESS = '255.255.255.255';
const RADMIN_ADDRESS_PREFIX = '26.';

function ipv4ToNumber(address) {
  return address.split('.').reduce((total, part) => ((total << 8) | Number(part)) >>> 0, 0);
}

function numberToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function calculateBroadcastAddress(address, netmask) {
  return numberToIpv4((ipv4ToNumber(address) | (~ipv4ToNumber(netmask) >>> 0)) >>> 0);
}

function listNetworkInterfaces() {
  const interfaces = [];
  for (const [interfaceName, addresses] of Object.entries(os.networkInterfaces())) {
    for (const entry of addresses || []) {
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      interfaces.push({
        name: interfaceName,
        address: entry.address,
        netmask: entry.netmask,
        broadcastAddress: calculateBroadcastAddress(entry.address, entry.netmask),
        isInternal: entry.internal,
        isRadmin: /radmin/i.test(interfaceName) || entry.address.startsWith(RADMIN_ADDRESS_PREFIX),
      });
    }
  }
  return interfaces;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

class RoomDiscovery {
  constructor(onRoomListChanged, { announceOnlyOnThisComputer = false, port = DISCOVERY_PORT } = {}) {
    this.onRoomListChanged = onRoomListChanged;
    this.announceOnlyOnThisComputer = announceOnlyOnThisComputer;
    this.port = port;
    this.roomsById = new Map();
    this.listeningSocket = null;
    this.announcingSocket = null;
    this.announceTimer = null;
    this.expirationTimer = null;
  }

  startListening() {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('error', (error) => console.error('[descoberta]', error.message));
    socket.on('message', (buffer, sender) => this.handleAnnouncement(buffer, sender));
    socket.bind(this.port);
    this.listeningSocket = socket;
    this.expirationTimer = setInterval(() => this.removeExpiredRooms(), EXPIRATION_CHECK_INTERVAL_MS);
  }

  stopListening() {
    this.stopAnnouncing();
    clearInterval(this.expirationTimer);
    if (this.listeningSocket) this.listeningSocket.close();
    this.listeningSocket = null;
  }

  startAnnouncing(getRoomDescription) {
    this.stopAnnouncing();
    const socket = dgram.createSocket('udp4');
    socket.on('error', (error) => console.error('[anúncio]', error.message));
    this.announcingSocket = socket;
    const announce = () => {
      if (this.announcingSocket !== socket) return;
      const announcement = Buffer.from(JSON.stringify({ tag: ANNOUNCEMENT_TAG, ...getRoomDescription() }));
      for (const destination of this.listAnnouncementDestinations()) {
        socket.send(announcement, this.port, destination, () => {});
      }
    };
    socket.bind(() => {
      socket.setBroadcast(true);
      announce();
      this.announceTimer = setInterval(announce, ANNOUNCE_INTERVAL_MS);
    });
  }

  stopAnnouncing() {
    clearInterval(this.announceTimer);
    this.announceTimer = null;
    if (this.announcingSocket) this.announcingSocket.close();
    this.announcingSocket = null;
  }

  listAnnouncementDestinations() {
    if (this.announceOnlyOnThisComputer) return new Set([LOOPBACK_ADDRESS]);
    const destinations = new Set([LOOPBACK_ADDRESS, LIMITED_BROADCAST_ADDRESS]);
    for (const networkInterface of listNetworkInterfaces()) {
      if (!networkInterface.isInternal) destinations.add(networkInterface.broadcastAddress);
    }
    return destinations;
  }

  handleAnnouncement(buffer, sender) {
    const announcement = parseJson(buffer.toString());
    if (!announcement || announcement.tag !== ANNOUNCEMENT_TAG || !announcement.roomId) return;
    let room = this.roomsById.get(announcement.roomId);
    if (!room) {
      room = { lastSeenByAddress: new Map() };
      this.roomsById.set(announcement.roomId, room);
    }
    Object.assign(room, announcement);
    room.lastSeenByAddress.set(sender.address, Date.now());
    this.publishRoomList();
  }

  removeExpiredRooms() {
    const now = Date.now();
    let somethingChanged = false;
    for (const [roomId, room] of this.roomsById) {
      for (const [address, lastSeen] of room.lastSeenByAddress) {
        if (now - lastSeen > ROOM_EXPIRATION_MS) {
          room.lastSeenByAddress.delete(address);
          somethingChanged = true;
        }
      }
      if (room.lastSeenByAddress.size === 0) {
        this.roomsById.delete(roomId);
        somethingChanged = true;
      }
    }
    if (somethingChanged) this.publishRoomList();
  }

  publishRoomList() {
    const myAddresses = new Set(listNetworkInterfaces().map((networkInterface) => networkInterface.address));
    const rooms = [...this.roomsById.values()].map((room) => {
      const addresses = [...room.lastSeenByAddress.keys()];
      const isOnThisComputer = addresses.some((address) => address === LOOPBACK_ADDRESS || myAddresses.has(address));
      return {
        roomId: room.roomId,
        roomName: room.roomName,
        hostName: room.hostName,
        port: room.port,
        participantCount: room.participantCount,
        liveCount: room.liveCount,
        hasPassword: room.hasPassword,
        address: isOnThisComputer ? LOOPBACK_ADDRESS : chooseBestRemoteAddress(addresses),
        addresses,
        isOnThisComputer,
      };
    });
    this.onRoomListChanged(rooms);
  }
}

function chooseBestRemoteAddress(addresses) {
  return addresses.find((address) => address.startsWith(RADMIN_ADDRESS_PREFIX)) || addresses[0];
}

module.exports = { RoomDiscovery, listNetworkInterfaces, DISCOVERY_PORT };
