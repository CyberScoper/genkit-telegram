# Genkit Telegram Assistant

A fully autonomous Telegram userbot that behaves like a human in group chats.
Built with [gramjs](https://github.com/gram-js/gramjs) for user-mode Telegram access, and [Genkit](https://github.com/firebase/genkit) for AI-powered reply generation via Google Gemini models.

![logo](https://github.com/user-attachments/assets/eda603b5-961e-46f2-a5f4-dc92af2309aa)

---

## 🧠 What it does
- Joins as a real Telegram user
- Replies only when:
  - You reply to **its messages**
  - You **mention** it by @username
- Occasionally jumps in with a random opinion, like a tired sarcastic cyclist
- Typing style looks human: lowercase, slang, short phrases, some "hmm" or "xз"
- Respects context of message threads (last 2 messages)
- Custom prompt for both replies and self-comments

---

## ⚙️ Requirements
- Node.js v18+
- Google Gemini API key
- Telegram API ID and Hash from https://my.telegram.org

---

## 🚀 Setup

1. **Clone this repo**:
```bash
git clone https://github.com/CyberScoper/genkit-telegram.git
cd genkit-telegram
```

2. **Install dependencies**:
```bash
npm install
```

3. **Create `.env` file**:
```dotenv
API_ID=your_telegram_api_id
API_HASH=your_telegram_api_hash
GOOGLE_API_KEY=your_google_gemini_api_key
RESPONSE_DELAY_MULTIPLIER=50
MIN_MESSAGE_LENGTH=5
RANDOM_COMMENT_CHANCE=0.01
```

4. **Run the assistant**:
```bash
npm start
```

📝 On first run, you'll be asked to enter your phone, confirmation code, and 2FA password if enabled.

---

## 🛠 Environment variables
| Variable                  | Description                                          |
|--------------------------|------------------------------------------------------|
| `API_ID`                 | Telegram API ID                                      |
| `API_HASH`               | Telegram API Hash                                    |
| `GOOGLE_API_KEY`         | Your Gemini Pro API Key                              |
| `RESPONSE_DELAY_MULTIPLIER` | Milliseconds per character in delay simulation     |
| `MIN_MESSAGE_LENGTH`     | Ignore messages shorter than this                   |
| `RANDOM_COMMENT_CHANCE`  | Probability of spontaneous message (0.0 - 1.0)       |

---

## 🧑‍💻 Run with PM2
```bash
npm install -g pm2
pm2 start user-ai-assistant.js --name telegram-ai
pm2 save
pm2 startup
```

Logs:
```bash
pm2 logs telegram-ai
```

---

## 🤖 Prompt Logic
- `reply` mode: mimics your human tone, keeps it casual
- `comment` mode: serious yet informal, makes occasional unsolicited remarks
- Will **never mention location**, **never act like an assistant**, and keeps all responses short

---

## ❓ Example use case
Create a Telegram group of cyclists, invite your AI-powered human-looking friend.
Let it observe. When pinged, it responds casually. Occasionally it drops a thoughtful remark. Nobody suspects.

---

Made with 💻, 🤖, and 😈 by @cyberscope

