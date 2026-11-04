export const content = {
  name: "KinBeat",
  nav: [
    { label: "Questions", href: "#faq" },
  ],
  headline: ["Find your exposed tokens", "before hackers do."],
  lead: "Billions of credentials leak every year from documents, GitHub and every machine identity.",
  cta: { primary: "Get a free scan", nav: "Contact us" },
  left: {
    modes: [
      { id: "files", label: "Upload a file" },
      { id: "drive", label: "Google Drive" },
      { id: "slack", label: "Slack" },
    ],
    // The samples shown on the page, in this order. The API keeps more samples for tests and evals.
    samples: [
      { id: "base64-email", title: "Token in an email" },
      { id: "example-only-ticket" },
      { id: "split-messages-chat" },
    ],
    choose: "Choose a file",
    driveOff: "Google Drive is not set up yet.",
    slackGroups: { public: "Public channels", private: "Private channels", group: "Group messages", dm: "Direct messages" },
    slackDisconnect: "Disconnect Slack",
    slackDenied: "Slack did not connect. If your Slack admin must approve apps, ask them first. You can also upload a Slack export zip in Upload a file.",
    slackFailed: "Slack did not connect. Try again.",
    slackLimit: "Your Slack Connect expires every 10 mins.",
    // {from} {to} {next} {last} are filled in by the page.
    slackRange: "Messages {from} to {to} scanned. Scan next reads {next} to {last}.",
    slackScanNext: "Scan next",
    slackMessages: "messages {from} to {to}",
    tokenLink: "Watch the video",
    tokenHintEnd: "on how to create one, or",
    // Our own unlisted videos (2026-11-04): the PR history token, and the private repository token.
    tokenHelpUrl: "https://youtu.be/Jzps1ccfwf0",
    repoTokenHelpUrl: "https://youtu.be/ZemkGAZ2gd8",
    tokenMore: "read the steps",
    tokenStepsTitle: "To create a read-only access token",
    tokenLess: "Show less",
    // For a private repository scan: the same token, with Contents read access instead of Pull requests.
    repoTokenSteps: [
      "On GitHub, click your profile picture at the top right, then Settings, Developer settings, Personal access tokens, Fine-grained tokens, and press Generate new token.",
      "Give it a name and an expiry of 30 to 90 days. Under Repository access, choose Only select repositories and pick the one to scan.",
      "Under Repository permissions, set Contents to Read-only. Then generate the token and copy it here.",
    ],
    prTokenSteps: [
      "On GitHub, click your profile picture at the top right, then Settings, Developer settings, Personal access tokens, Fine-grained tokens, and press Generate new token.",
      "Give it a name and an expiry of 30 to 90 days. Under Repository access, choose Only select repositories and pick the one to scan.",
      "Under Repository permissions, set Pull requests to Read-only. Then generate the token and copy it here.",
    ],
    scan: "Scan",
    cancel: "Cancel",
    badAnswer: "The server sent an unexpected answer. Try again.",
    scanAgain: "Scan again",
  },
  right: {
    cancelled: "Scan cancelled.",
    tallyNames: { real: "real", possible: "possible", example: "example", other: "not scanned" },
    // From mock-up 01.
    progressTitle: "Scan in progress",
    one: "1 finding",
    many: "findings",
    none: "No exposed tokens found",
    noneUnread: "No exposed tokens found in what was read",
    noneUnchecked: "We could not check this now. Please try again later.",
    // The step a running scan is at. The numbers come from the server.
    prProgress: "Reading pull requests",
    slackProgress: "Reading Slack messages",
    steps: {
      download: "Downloading the repository",
      site: "Downloading the website",
      files: "Reading files",
      pictures: "Reading pictures",
      ai: "Checking findings with the AI",
    },
    inLabel: "Source: ",
    repoCommit: "Commit",
    filesRead: "Files read",
    fileRead: "File read",
    closeFinding: "Close",
    openFinding: "Open",
    close: "Close",
    repoSkipped: "Not scanned",
    countsOnlyNote: "Public repositories which you don't own get only the count of exposed secrets, to avoid exploitation. If this is your repository, paste a read-only token here to see each secret. It is used for this scan only and never stored.",
    // The button under that note and under a token ask. It puts the token line into the box; the visitor pastes the token after it and presses Scan.
    shareToken: "Share a read access token",
    notChecked: "not checked by AI",
    scriptsNotRead: "scripts of the site",
    verdict: {
      timeout: "AI check timed out",
      limit: "Not judged: scan limit",
    },
    file: "File",
    where: "Found at",
    hiddenAs: "The secret was hidden as",
    reason: "Why the KinBeat AI said so",
    seeLine: "See here",
    openOnGithub: "Open this line on GitHub",
    hideLine: "Hide",
    reasonOff: "Not asked. Rules only.",
  },
  // The one box at the bottom of the scan window: a question for KinBeat AI, or a link or chat to scan.
  ask: {
    askPlaceholder: "Ask about your scan or a leaked key",
    running: "Your scan is still running. Ask again when it finishes.",
    you: "You",
    // The first bubble in the chat, from KinBeat AI, written by code (approved wording, 2026-11-04).
    welcome: "KinBeat helps find exposed keys, tokens and passwords in content you choose to scan. One scan covers one link, one pasted text, one file, one Slack chat or one Drive file. What would you like to scan? Tell us in the box below.",
    // KinBeat AI's bubble once Slack is connected (written by code): the chat list, Scan and Cancel sit in it.
    slackPick: "Slack is connected. Pick a chat to scan.",
    // A repository GitHub would not open. KinBeat AI asks; Private leads to a token ask in the chat (draft wording, 2026-11-04).
    repoAsk: "I could not open that repository. Is it public or private?",
    repoPublic: "Public",
    repoPrivate: "Private",
    repoNotFound: "Repository not found. Check the link and try again.",
    repoToken: "To scan a private repository, paste a read-only token here. It is used for this scan only and never stored.",
    // What the Share a read access token button puts into the box. The token goes after it.
    tokenPrefix: "My read access token is: ",
    // The PR history scan from the chat: the link first, then the token (draft wording, 2026-11-04).
    historyPick: "Scan my GitHub PR history",
    historyLink: "Send the link of the repository. KinBeat reads its last 100 merged pull requests, or those merged into the branch in the link.",
    historyBadLink: "That is not a GitHub repository link. Send one like https://github.com/owner/repository.",
    historyToken: "To read pull requests we need a read-only token. It is used for this scan only and never stored.",
    tokenPlaceholder: "Paste your read-only token",
    tokenPasted: "Token pasted",
    // Shown above every answer, so visitors know who is talking.
    aiName: "KinBeat AI",
    // Once the day's AI budget is used: the box scans only, with the three picks under it, and this line above it.
    capped: "KinBeat AI has reached today's limit. Scans still work.",
    scanPlaceholder: "Paste a link or a chat to find exposed tokens",
    scan: "Scan",
    // The button under an answer about a file, Google Drive or Slack. It opens the picker, so the scan starts from the chat.
    picks: { files: "Upload a file", drive: "Connect Google", slack: "Connect Slack" },
    // What KinBeat AI says when a help pick asks for a file, Drive or Slack scan; the button above opens the picker.
    pickLines: {
      files: "Choose the file to scan: a PDF, a Word file, a zip, code, a config file or a screenshot. One file at a time, up to 10 MB.",
      drive: "Connect your Google Drive and pick the file to scan.",
      slack: "Connect your Slack and pick the chat to scan.",
    },
    // The + button in the box.
    plus: "Add a file or connect Google Drive or Slack",
    // The Ask KinBeat AI box's button.
    askTag: "Send",
    // Progress while KinBeat AI answers, shown like a scan. The steps move on by time, not by the server.
    thinkingTitle: "KinBeat AI is answering",
    thinkingSteps: ["Reading your question", "Checking your scan", "Writing the answer"],
    // The "What can I ask?" panel: examples that fill the box, three sample chats to copy, what each scan shows, then tips and limits.
    help: {
      open: "What can I ask?",
      close: "Close",
      intro: "Click any example to fill the box.",
      // Drive and Slack fill the box like the questions. Sending that line puts the Connect step in the chat.
      picks: [
        { action: "files", label: "Upload a file" },
        { action: "drive", label: "Scan a Google Drive file" },
        { action: "slack", label: "Scan my Slack chats" },
      ],
      queries: ["Scan my GitHub PR history", "What can KinBeat scan?", "What can you find in GitHub?", "What can you find in Google Drive?", "What can you find in a PDF?", "What can you find in a screenshot?"],
      samplesTitle: "Try a sample chat",
      samplesNote: "Copy one and paste it into the box.",
      copy: "Copy",
      copied: "Copied",
      showsTitle: "What each scan shows",
      shows: [
        "Pasted text or a file: each secret with its type, the line or page, a masked preview, and the AI's verdict - real, possible or example.",
        "Website: the same, with the page the secret sits on.",
        "GitHub repository: the file and line in a repository you own, with a read token. Public repositories you do not own show counts only.",
        "GitHub PR history: the pull request, file and line for each secret in the last 100 merged pull requests.",
        "Google Drive: the file and the line, read once and never stored.",
        "Slack: the chat and the message, read once and never stored.",
      ],
      tipsTitle: "Tips and limits",
      tips: [
        "It answers questions about this scan, finding types, changing keys and stopping leaks.",
        "It cannot test whether a key works. Treat every found key as exposed.",
        "It never shows a full secret.",
        "It gives no legal advice.",
        "One scan covers one link, one text, one file, one Slack chat or one Drive file.",
      ],
    },
  },
  scanSection: {
    title: "Ask KinBeat AI",
    // 98.9% is the latest live run (2026-11-02); 230,000 counts cases before launch plus the 100,000-message Slack test (user decision, 2026-11-02).
    strip: "Tested over 230,000+ cases with an accuracy of 98.9%.",
  },
  faq: {
    title: "Frequently asked questions",
    // Approved wording, 2026-11-03. The AI line is true for our own Modal server: a raw piece, no copy kept (muse.client.ts).
    items: [
      { q: "Is the scan free?", a: "Yes. Every scan is free for now, while KinBeat is new. We will say so here before that changes." },
      { q: "What can I scan?", a: "You can paste a chat, upload a screenshot or image, a PDF, a config file or any other file. You can also scan your GitHub repositories, public and private, your GitHub PR history (up to 100 pull requests for free), a web page, your Slack chats or a Google Drive file. One file at a time, files up to 10 MB." },
      { q: "What about my privacy?", a: "We never store your text, files, chats or secrets." },
      { q: "Does my text go to an AI?", a: "No, not as you typed it. Only a small piece of up to 400 characters around a finding goes to KinBeat's own AI server, which keeps no copy. It never goes to an outside AI service." },
      // The + menu entries (2026-11-04).
      { q: "How do I scan a file from my computer?", a: "Press + in the chat box, choose Upload a file and pick one file up to 10 MB. PDFs, Word files, zips, code, config files and screenshots work." },
      // The two GitHub answers are the user's wording (2026-11-04), grammar fixed. "{video}" becomes a link to the video.
      {
        q: "How do I scan a GitHub repository?",
        a: "You can scan a public repository by pasting the link in the chat directly. Public repositories which you don't own get only the count of exposed secrets, to avoid exploitation. If you own the repository, or if it is private, you can share a read access token and we will show each result in the chat. The token is never saved and expires right after access. Watch {video} to see how.",
        video: "https://youtu.be/ZemkGAZ2gd8",
      },
      {
        q: "Can I scan my pull request history?",
        a: "Yes. You can scan up to 100 merged pull requests on a specific branch, or on the default branch when the link names none. We need a read access token to confirm your identity. Check {video} to see how to create one. These tokens are not stored anywhere on our platform, to maintain privacy. Public repositories which you don't own get only the count of exposed secrets, to avoid exploitation.",
        video: "https://youtu.be/Jzps1ccfwf0",
      },
      // Approved 2026-11-04. 10,000 is SLACK_SCAN_MESSAGES and 10 minutes is SLACK_SESSION_MINUTES in the API.
      { q: "Can I scan my Slack chats?", a: "Press + in the chat box, choose Slack, connect your workspace and pick a channel. KinBeat reads up to 10,000 messages per scan and keeps no copy. The connection expires after 10 minutes without use, and you can disconnect at any time." },
      { q: "How do I scan a Google Drive file?", a: "Press + in the chat box, choose Google Drive, sign in and pick one file. KinBeat reads it once and never stores it." },
      { q: "How are hidden tokens found?", a: "KinBeat's own rules and decoders read scrambled text (base64), hex, URL codes, spelled-out letters, NATO code words, number words and tokens split over messages. We tested them on over 230,000 cases." },
      { q: "How accurate is KinBeat?", a: "We scored 98.9% in our latest live run. No scanner is perfect, so treat every found key as exposed and change it." },
    ],
  },
  // The contact form at the end of the page (approved wording, 2026-11-04). Messages go to the team's logs page.
  contact: {
    title: "Contact us",
    lead: "Have a question, want a finding explained, or need a bigger repository scanned by us? Drop us a line.",
    name: "Name",
    email: "Email",
    message: "Message",
    send: "Send",
    sending: "Sending",
    thanks: "Thanks, we got your message. We reply by email.",
    failed: "The message did not go through. Try again in a moment.",
  },
  copyright: "© 2026 Soumya Das",
  // Outside reports, shown with their source like GitGuardian does. Each number was checked against its report on 2026-11-02.
  proof: [
    { figure: "88%", text: "of breaches in basic web app attacks used stolen credentials", source: "Verizon DBIR 2025", url: "https://www.verizon.com/business/resources/reports/dbir/" },
    { figure: "28.6M+", text: "new secrets leaked in public GitHub commits in 2025", source: "GitGuardian, State of Secrets Sprawl 2026", url: "https://www.gitguardian.com/state-of-secrets-sprawl-report-2026" },
    { figure: "3.3B", text: "stolen credentials and cloud tokens from infostealers in 2025", source: "Flashpoint, 2026 Global Threat Intelligence Report", url: "https://flashpoint.io/blog/global-threat-intelligence-report-2026/" },
    { figure: "109:1", text: "machine identities for every human identity", source: "Palo Alto Networks, Identity Security Landscape 2026", url: "https://www.paloaltonetworks.com/idira/identity-security-landscape-report" },
  ],
  // The size of it: a dot field, a live count beside it, and the outside report numbers (proof) under both.
  size: {
    title: "Every dot below represents 100,000s of those leaked secrets.",
    // 286 dots (28.6 million / 100,000), scattered over a faint grid of 2,865 places.
    dots: 286,
    places: 2865,
    // GitGuardian's 2025 total, spread evenly over the year's seconds for the live count.
    yearTotal: 28_649_024,
    // The title line: the number, then these words (wording from mock-up 01).
    yearLine: "new secrets leaked on public GitHub in 2025.",
    // The card's live numbers: scans started, and sessions (one visitor on one day). {sessions} is filled in by the page.
    sinceTitle: "Since going live",
    // Added to the live scan count: the scans the owner ran by hand before launch. The owner gives the number.
    scansBase: 0,
    sinceText: "scans have run on KinBeat, for {sessions} visitors.",
  },
  leak: {
    title: "This could be your live data",
    chat: [
      { who: "[10:43] emma:", text: "deploy is failing again" },
      { who: "[10:45] jack:", text: "The SSO key ", key: "AK••••••••••01", after: " was missing" },
      { who: "[10:45] emma:", text: "thanks, pasting it into the config now" },
    ],
    note: "One message is enough",
    // Two more places a key hides. Names and values are made up and masked.
    files: [
      { kind: "github", name: "deploy.yml", place: "GitHub, line 14", line: "token: ", key: "ghp_••••••" },
      { kind: "drive", name: "Q3 plan", place: "Google Drive", line: "api_key: ", key: "AIza••••••" },
      { kind: "slack", name: "#deploys", place: "Slack", line: "webhook: ", key: "xoxb-••••••" },
      { kind: "pdf", name: "report.pdf", place: "page 2", line: "password: ", key: "••••••••" },
    ],
  },
};
