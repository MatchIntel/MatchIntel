# Deploy the fixed Helper v0.12.2

Your supplied log starts with Helper 0.12.1 and shows the old single-field list. That deployment does not contain the v0.12.2 fix.

This ZIP now contains package.json, src/, assets/, Dockerfile and the other bot files directly at its top level. There is no extra discord-bot folder to accidentally nest.

1. Railway: select the Helper BOT service, then Settings > Source. Check the connected GitHub repository and branch. Check its Root Directory setting too.
2. Extract this ZIP. Put ALL of its contents in that exact bot folder in the connected repository, replacing matching files. A blank Root Directory means the repository root; a Root Directory of /discord-bot means the existing discord-bot folder. Keep existing backend/ or other services intact.
3. Include src/index.js, src/keyInfo.js, package.json, package-lock.json and assets/. Do not upload just this ZIP or only package.json. Do not change Railway variables or the database.
4. Commit and push. Open the new Railway deployment and verify it is building that NEW commit. Redeploying an old commit runs the old code again.
5. Wait for the new deployment to become active. Its NEW startup logs must say:

   Quilted Tweaks Helper 0.12.2 logged in as ...

6. Run /listkeys limit:25. Each result has its own Key field. If the NEW deployment still logs 0.12.1, recheck the repository, branch, Root Directory, commit and whether you selected the bot service. Also make sure another bot service with the same token is not still running an older copy.

No backend or EXE update is needed for this list fix. Backend v0.12.1 remains current for Discord-user /keyinfo.

Verified: the exact 15 unique records in your uploaded error log reproduce the failure under v0.12.1 and render successfully under the included v0.12.2. The fixed bot previously passed all 65 automated tests, including 0/1/15/25 results and private reply flags. Code is unchanged from that tested fix; only packaging and deployment instructions have changed. Live Railway/Discord deployment has not been performed here.
