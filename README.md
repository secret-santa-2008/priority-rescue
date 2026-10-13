# Priority Rescue

Priority Rescue is an operations console for the fictional Cedarline Community Medical Center Emergency Department. Assessment requests are synthetic operating-system tasks used to demonstrate scheduling; they are not patients, clinical work or real hospital data. The application does not connect to hospital systems.

## Requirements

- Node.js 18 or newer and npm
- VS Code (optional)
- SQL Server and SQL Server Management Studio only if persistent SQL run history is needed

## Start the application on Windows

From PowerShell, open the current project in VS Code with:

```powershell
code .
```

In the first integrated terminal run:

```powershell
npm install
npm run dev:api
```

Open a second integrated terminal in the same folder and run:

```powershell
npm run dev
```

Open `http://127.0.0.1:5173/` in Chrome. The API listens on `http://127.0.0.1:3001/`; Vite proxies `/api` requests to it. If the API is stopped, scheduler pages still work, but saving run records is unavailable.

## Optional SQL Server persistence

The API uses in-memory run history by default. SQL credentials are not included in this project.

1. Start a local SQL Server instance and open `database/setup.sql` in SQL Server Management Studio. Execute it using a SQL Server account allowed to create the `PriorityRescue` database. The script creates the database and `dbo.SimulationRuns` table; it does not create logins or passwords.
2. Copy `.env.example` to `.env` in the project root.
3. Set `DB_SERVER`, `DB_NAME`, `DB_USER` and `DB_PASSWORD` to values supplied by your SQL Server administrator. For a local TCP SQL Server instance, `DB_SERVER=localhost` and `DB_PORT=1433` are common settings when TCP/IP is enabled. Set `DB_ENCRYPT` according to your server's TLS configuration. For local development with a self-signed certificate only, `DB_TRUST_SERVER_CERTIFICATE=true` may be needed.
4. Restart `npm run dev:api`. The header/About page reports whether the API and SQL Server connection are available.

Do not commit `.env`. If the required SQL settings are absent, the API explicitly stores records in process memory. A configured SQL failure returns an error rather than silently falling back to memory.

## Pages and challenges

- Overview explains the inversion scenario and measured C1 comparison.
- Live scheduler supports Run, one-tick Step, Pause/Resume, Reset and PIP selection.
- C1 uses L(1) arrival 0 / 3 ticks, H(3) arrival 1 / 1 tick and M(2) arrival 2 / 4 ticks.
- C2 removes M to isolate ordinary mutex blocking.
- C3 runs 1,000 finite tasks (priorities 1–3, durations 1–3) sharing mutex R. It retains at most 200 detailed events while accumulating metrics for the full run.
- C4 uses safe stop at logical time 2 when L fails while owning R. The lock owner and waiter queue are retained for diagnosis.
- C5 compares the same C1 workload with and without PIP.
- Analytics, OS concepts, execution logs, test centre and About/architecture pages provide the corresponding measured outputs and explanations.

Equal-priority ready tasks use FIFO arrival order, then declaration order. Mutex waiters are handed R by effective priority, then FIFO arrival order. Base priority remains fixed; effective priority changes only while inheritance applies.

## Verification

```powershell
npm test
npm run build
```

The Test Centre runs scheduler checks directly in the browser and shows the result of each check rather than prefilled statuses.

## Local API

- `GET /api/health` — API and SQL configuration status
- `POST /api/runs` — save one calculated simulation summary
- `GET /api/runs` — list up to 100 SQL records or current-process memory records
- `GET /api/runs/:id` — fetch a saved run
