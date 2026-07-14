# Overwolf testing checklist

During a real tournament verify the Event Health panel receives:

- `sessionID`
- `matchID`
- `roster_0` through the final roster entry
- each roster player's `team_id`
- `total_players` and `total_teams`
- `message_feed`
- `matchStart` and `matchEnd`

Fortnite's official Overwolf integration exposes the full roster, but anonymous mode can replace a name with `anonymous`. Dynamic total-player and total-team fields update as players and teams join, leave or die. The raw event preview is included so a changed payload can be mapped without guessing.

Use Overwolf's GEP Simulator for interface testing, then validate the actual Fortnite payload in a real match.
