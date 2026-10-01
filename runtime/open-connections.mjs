const key = Symbol.for('checkers.open-connections');

function state() {
  if (!globalThis[key]) {
    globalThis[key] = {
      nextId: 0,
      connections: new Map(),
      counts: {
        player: { anonymous: 0, authenticated: 0 },
        spectator: { anonymous: 0, authenticated: 0 },
      },
    };
  }
  return globalThis[key];
}

function validRole(role) {
  return role === 'player' || role === 'spectator';
}

function setCount(record, role, auth, delta) {
  if (!role) return;
  record.counts[role][auth] += delta;
}

export function trackOpenConnection(role, auth) {
  const record = state();
  const id = ++record.nextId;
  let current = validRole(role) ? { role, auth } : undefined;
  setCount(record, current?.role, current?.auth, 1);
  record.connections.set(id, current);
  let closed = false;
  return {
    set(nextRole, nextAuth = auth) {
      if (closed) return;
      const next = validRole(nextRole) ? { role: nextRole, auth: nextAuth } : undefined;
      if (current?.role === next?.role && current?.auth === next?.auth) return;
      setCount(record, current?.role, current?.auth, -1);
      current = next;
      setCount(record, current?.role, current?.auth, 1);
      record.connections.set(id, current);
    },
    close() {
      if (closed) return;
      closed = true;
      setCount(record, current?.role, current?.auth, -1);
      record.connections.delete(id);
    },
  };
}

export async function collectOpenConnections() {
  const counts = state().counts;
  return {
    player: { ...counts.player },
    spectator: { ...counts.spectator },
  };
}
