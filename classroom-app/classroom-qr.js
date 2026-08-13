const PREFIX = 'CLASSROOM-CALL-ROOM-1';

function createClassroomQrPayload(name, connectionCode) {
  const roomName = String(name || '本教室').trim().slice(0, 40) || '本教室';
  const code = String(connectionCode || '').trim();
  if (!/^\d{3}-\d{3}-\d{3}$/.test(code)) throw new Error('教室连接码无效');
  const body = Buffer.from(JSON.stringify({
    version: 1,
    type: 'classroom',
    name: roomName,
    connectionCode: code,
  }), 'utf8').toString('base64url');
  return `${PREFIX}.${body}`;
}

module.exports = { PREFIX, createClassroomQrPayload };
