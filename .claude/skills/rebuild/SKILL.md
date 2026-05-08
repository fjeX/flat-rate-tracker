---
name: rebuild
description: "Rebuild and redeploy the Flat Rate Tracker Docker container after a git pull. Use when Liem says 'rebuild', '/rebuild', 'deploy latest', or 'push the new changes to the app'."
---

# Rebuild — FRT Docker Redeploy

Pull the latest code and rebuild the Docker image so new changes go live on `tracker.slimelab.cc`.

Run the following steps using the Bash tool from this directory (`~/docker/flat-rate-tracker`).

## Steps

1. **Pull latest code**
   ```bash
   git pull origin master
   ```

2. **Check for new migrations**
   ```bash
   git log --oneline ORIG_HEAD..HEAD -- supabase/migrations/
   ```
   - Empty output → no migrations, continue
   - Shows commits → new migrations came in; apply them via the Supabase SQL editor before rebuilding

3. **Rebuild and redeploy**
   ```bash
   docker compose down && docker compose build && docker compose up -d
   ```

4. **Verify**
   ```bash
   docker compose ps
   ```
   - `app` service should show `Up`
   - If it shows `Exit` or `Restarting`: `docker compose logs --tail=50`
