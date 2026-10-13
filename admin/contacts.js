// Reads participants' emails from the Google Form export, entirely in the browser.
// The result is kept in the admin's localStorage only; it is never sent anywhere.

export function slug(name) {  // same as scripts/build_rosters.py slug()
  const s = name.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().trim();
  return "usr_" + s.replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "");
}

// known: Map(participantId -> name). Returns { contacts: {participantId: email}, unknown: [names] }
export function parseContacts(text, known) {
  const contacts = {}, unknown = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(line.includes("\t") ? "\t" : ",").map(c => c.trim().replace(/^"|"$/g, ""));
    const emailAt = cells.findIndex(c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c));
    if (emailAt < 1) continue;
    // Form export: timestamp, name, club, email…; older sheets: name, club, …, email
    const name = /^\d{1,2}\/\d{1,2}\/\d{4}/.test(cells[0]) ? cells[1] : cells[0];
    const id = slug(name);
    if (known.has(id)) contacts[id] = cells[emailAt].toLowerCase();
    else unknown.push(name);
  }
  return { contacts, unknown };
}
