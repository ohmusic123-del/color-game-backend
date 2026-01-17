# ✅ Color Game Backend - Deploy Notes (Phase-3)

## 1) Setup
```bash
npm install
```

Create `.env` using `.env.example`.

## 2) Run Locally
```bash
npm run dev
```

## 3) Important Security Notes
- Deposits are **PENDING** by default
- Wallet credits happen only after **Admin Approval**
- Daily withdrawal limit is enabled via `DAILY_WITHDRAW_LIMIT`

## 4) Admin Audit Logs
Admin actions are stored in MongoDB collection:
`adminauditlogs`
