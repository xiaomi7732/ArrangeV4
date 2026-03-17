# Arrange

**The todo app that lives in your calendar — not on someone else's server.**

Arrange helps you organize and prioritize tasks with powerful views like the Eisenhower Matrix — and more to come. It plugs directly into your Microsoft Outlook calendar, so your tasks stay where your schedule already lives.

**👉 [Try it now at arrange.codewithsaar.com](https://arrange.codewithsaar.com)**

## 🧑‍💻 The Story

This is my fourth attempt at building Arrange (hence "V4"). The idea has been stuck in my head for years — a todo app that doesn't ask you to trust yet another cloud service with your data. Each version taught me something, and this one finally feels right.

## 🔒 Your Data, Your Calendar

Most productivity apps store your tasks on their servers. Arrange doesn't.

Every task you create is a **calendar event in your own Microsoft Outlook account**. There is no Arrange database. No server-side storage. No data harvesting. When you delete the app, your tasks are still right there in your calendar — because they always were.

- **No backend servers** — Arrange is a static app; there is nothing between you and your calendar.
- **No accounts to create** — sign in with your existing Microsoft account.
- **No data collection** — we don't see, store, or process your tasks. Ever.
- **Full portability** — your tasks are standard calendar events you can view in Outlook, the web, or any calendar client.

## ✨ Features

- **Eisenhower Matrix** — drag-and-drop cards between four priority quadrants (more views coming soon).
- **Multiple books** — organize tasks into separate calendars (e.g. "Work" and "Personal").
- **Status tracking** — mark tasks as New, In Progress, Blocked, Finished, or Cancelled.
- **Checklists & remarks** — add sub-tasks and notes to any item.
- **Auto-bump** — stale tasks automatically move forward so nothing falls through the cracks.
- **Optimistic UI** — instant feedback; changes sync to your calendar in the background.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A Microsoft account (personal or organizational)

### Try It

Head to **[arrange.codewithsaar.com](https://arrange.codewithsaar.com)**, sign in with your Microsoft account, and create your first book.

### Run Locally

```bash
cd src/arrange-v4
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to run your own instance.

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_AZURE_CLIENT_ID` | Azure AD app registration client ID | Built-in dev ID |
| `NEXT_PUBLIC_BASE_PATH` | Base path for hosted deployments (e.g. `/ArrangeV4`) | `""` |
| `NEXT_PUBLIC_APP_VERSION` | Version string shown in the UI | `"local"` |

## 🏗️ How It Works

Arrange is a client-side [Next.js](https://nextjs.org/) app that authenticates via [MSAL](https://learn.microsoft.com/en-us/entra/msal/) and talks directly to the [Microsoft Graph API](https://learn.microsoft.com/en-us/graph/overview).

```
┌────────────┐       ┌───────────────┐       ┌──────────────────┐
│  Arrange   │──────▶│  Azure AD     │──────▶│  Microsoft Graph │
│  (browser) │◀──────│  (auth only)  │       │  (your calendar) │
└────────────┘       └───────────────┘       └──────────────────┘
```

- **Books** are Outlook calendars with a `" by arrange"` suffix.
- **Tasks** are calendar events with structured JSON metadata embedded in the event body.
- **No middleware** — the browser calls Graph directly with your OAuth token.

## 📁 Project Structure

```
src/arrange-v4/
├── app/                  # Next.js pages (home, books, matrix)
├── components/           # React components (modals, menus, cards)
├── lib/                  # Services (Graph API, MSAL, data parsing)
└── public/               # Static assets
```

## ⭐ Like Arrange?

If you find Arrange useful, consider giving it a **star on GitHub** — it helps others discover the project and keeps me motivated to keep building!

[![GitHub stars](https://img.shields.io/github/stars/xiaomi7732/ArrangeV4?style=social)](https://github.com/xiaomi7732/ArrangeV4)

## 📄 License

This project is licensed under the [MIT License](LICENSE).
