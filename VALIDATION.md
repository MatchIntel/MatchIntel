# Validation status

Performed in the build environment:

- every JavaScript file passed `node --check`;
- every JSON file parsed successfully;
- every relative JavaScript import points to an existing file;
- every dashboard JavaScript element reference maps to an HTML element;
- every manifest window and icon path exists;
- the ZIP archive passed integrity testing.

Not possible in this environment:

- launching the Overwolf runtime;
- receiving real Fortnite Game Events;
- connecting to a live Railway PostgreSQL service;
- installing npm dependencies from the registry, because registry access timed out.

Run the included backend tests after `npm install`:

```powershell
cd backend
npm test
```

The first real tournament test should focus on the raw `roster_*`, `sessionID`, `matchID`, `total_players`, `total_teams`, and `message_feed` payloads shown in Event Health.
