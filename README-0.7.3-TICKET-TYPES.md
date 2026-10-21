# MatchIntel Discord Bot 0.7.3 — Ticket Types

This update is compatible with the existing MatchIntel backend 0.7.2. No database migration or backend change is required.

## Changes

- `/setuptickets` now posts one panel with three choices:
  - **General Support**
  - **Purchase MatchIntel**
  - **Report a Bug**
- Every ticket is still created inside the same configured MatchIntel ticket category.
- The selected type is included in the channel name so staff can identify it immediately:
  - `general-support-username-1234`
  - `purchase-username-1234`
  - `bug-report-username-1234`
- The opening ticket embed also displays the selected type and gives type-specific instructions.
- The unnecessary **Privacy** field was removed from the public ticket panel.
- Existing old panels using the original **Open a ticket** button remain compatible and create a General Support ticket.

## Deploy

Replace the files in your current Discord bot project with this folder, redeploy it, then run `/setuptickets` again in the support channel. The command posts the new three-button panel. Delete the old panel message afterward if you no longer need it.

The existing one-open-ticket-per-user rule remains unchanged.
