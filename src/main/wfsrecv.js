'use strict';
// Received marks on WFS shipments (owner 2026-10-15): a shipment logged on
// any desktop is marked received from Recovery → WFS Inventory → Not
// received, and the mark rides the shared folder as the `wfsrecv` aux log
// so every desktop agrees. Each line is { key: "STATION:id", receivedAt
// (ISO, '' = not received), ts }; the newest line on a key wins.

// key -> the newest mark
function latestMarks(events) {
  const marks = new Map();
  for (const e of events || []) {
    if (!e || !e.key) continue;
    const cur = marks.get(e.key);
    if (!cur || (Number(e.ts) || 0) >= (Number(cur.ts) || 0)) marks.set(e.key, e);
  }
  return marks;
}

// set each shipment's received_at from its mark; writeBack(id, at) is called
// for this station's own shipments whose stored stamp differs
function applyMarks(shipments, marks, writeBack) {
  for (const s of shipments || []) {
    const m = marks.get(s.key);
    if (!m) continue;
    const at = String(m.receivedAt || '');
    if (s.mine && String(s.received_at || '') !== at && writeBack) writeBack(s.id, at);
    s.received_at = at;
  }
  return shipments;
}

// "STATION:12" or a bare local id -> { owner, id, key, own }
function parseKey(raw, station) {
  const s = String(raw ?? '');
  const cut = s.lastIndexOf(':');
  const owner = cut >= 0 ? s.slice(0, cut) : String(station || '');
  const id = Number(cut >= 0 ? s.slice(cut + 1) : s);
  return { owner, id, key: `${owner}:${id}`, own: owner === String(station || '') && Number.isFinite(id) };
}

module.exports = { latestMarks, applyMarks, parseKey };
