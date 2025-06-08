```
webjmail/
├── src/
│   ├── api/
│   │   ├── jmap.ts          # JMAP client wrapper
│   │   ├── auth.ts          # Authentication
│   │   └── types.ts         # TypeScript types
│   ├── stores/
│   │   ├── authStore.ts     # Authentication state
│   │   ├── mailStore.ts     # Email state
│   │   ├── uiStore.ts       # UI state
│   │   └── index.ts
│   ├── hooks/
│   │   ├── useJMAP.ts       # JMAP hooks
│   │   ├── useMailbox.ts    # Mailbox operations
│   │   └── useMessage.ts    # Message operations
│   ├── components/
│   │   ├── Layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── Layout.tsx
│   │   ├── Mailbox/
│   │   │   ├── MailboxList.tsx
│   │   │   ├── MailboxItem.tsx
│   │   │   └── MailboxTree.tsx
│   │   ├── Message/
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageItem.tsx
│   │   │   ├── MessageView.tsx
│   │   │   └── MessageComposer.tsx
│   │   └── common/
│   │       ├── Button.tsx
│   │       ├── Input.tsx
│   │       └── Loading.tsx
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Mail.tsx
│   │   └── Settings.tsx
│   ├── utils/
│   │   ├── date.ts
│   │   ├── format.ts
│   │   └── sanitize.ts
│   ├── App.tsx
│   └── main.tsx
├── package.json
├── vite.config.ts
├── tsconfig.json
└── uno.config.ts
```
