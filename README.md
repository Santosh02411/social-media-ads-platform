# ⚡ AdSync — Unified Social Media Ads Platform

An AI-powered multi-platform social media advertising dashboard built with Python & Flask that allows users to create, publish, schedule, and monitor advertisements across multiple social media platforms from a single unified interface.

---

# 🚀 Features

### 🔐 Authentication & User Management

- User Registration & Login
- Secure Authentication System
- Admin & User Roles
- User Profile Management

### 📱 Multi-Platform Integration

- Facebook Ads Integration
- Instagram Posting Support
- Twitter/X API Integration
- LinkedIn Ad Publishing
- TikTok Content Posting
- Pinterest Ad Publishing

### 📤 Ad Publishing System

- Text-based Ads
- Image Ads
- Video Ads
- Audio Promotions
- Multi-platform Publishing
- Real-time Posting Status

### 🕒 Smart Scheduling System

- Future Ad Scheduling
- Automatic Background Posting
- Scheduled Campaign Management
- Real-time Scheduler Monitoring

### 📊 Analytics & Monitoring

- Ad Publishing History
- Platform-wise Status Tracking
- Campaign Statistics
- Performance Monitoring Dashboard

### 📂 Media Management

- Media Upload System
- Image & Video Handling
- Audio File Support
- Secure File Storage

### 🎨 UI/UX Features

- Responsive Dashboard Interface
- Dark Industrial Theme
- Interactive Notifications
- Real-time Event Updates

---

# 🛠️ Tech Stack

| Layer | Technologies Used |
|-------|------------------|
| Backend | Python, Flask |
| Frontend | HTML5, CSS3, JavaScript |
| Database | SQLite / MySQL |
| APIs & Services | Facebook Graph API, Twitter API v2, LinkedIn API, TikTok API, Pinterest API |
| Authentication | OAuth 2.0 |
| Real-time Events | Flask Polling / Scheduler |

---

# 📂 Project Structure

```bash
social-ads-platform/
│
├── app.py                      # Flask backend
├── requirements.txt            # Python dependencies
├── .env.example                # Environment variables template
├── README.md                   # Project documentation
├── information.md              # Detailed setup guide
├── run.sh                      # Startup script
│
├── api/
│   ├── __init__.py
│   ├── facebook_connector.py
│   ├── instagram_connector.py
│   ├── twitter_connector.py
│   ├── linkedin_connector.py
│   ├── tiktok_connector.py
│   ├── pinterest_connector.py
│   └── scheduler.py
│
├── templates/
│   └── index.html
│
└── static/
    ├── css/
    │   └── style.css
    │
    ├── js/
    │   └── app.js
    │
    └── uploads/
```

---

# ⚡ Quick Start

## 1️⃣ Clone the Repository

```bash
git clone https://github.com/your-username/social-ads-platform.git
cd social-ads-platform
```

## 2️⃣ Install Dependencies

```bash
pip install -r requirements.txt
```

## 3️⃣ Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and add:

- SECRET_KEY
- API Keys
- OAuth Tokens
- Platform Credentials

---

## 4️⃣ Run the Application

```bash
python app.py
```

or

```bash
bash run.sh
```

---

# 🌐 Application URL

Open in browser:

```bash
http://127.0.0.1:5000
```

---

# 🔌 Platform Connection Workflow

1. Open Dashboard
2. Select Platform
3. Enter API Credentials
4. Click Connect
5. Start Publishing Ads

---

# 📤 Ad Publishing Workflow

1. Create Ad Campaign
2. Add Ad Content
3. Upload Media Files
4. Select Target Platforms
5. Publish Instantly or Schedule
6. Monitor Real-time Status

---

# 📡 REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/platforms` | Get connected platforms |
| POST | `/api/connect` | Connect platform |
| POST | `/api/disconnect` | Disconnect platform |
| POST | `/api/test-connection` | Validate credentials |
| POST | `/api/upload` | Upload media |
| POST | `/api/post` | Publish ads |
| GET | `/api/history` | Fetch post history |
| GET | `/api/stats` | Analytics & statistics |
| POST | `/api/schedule` | Schedule post |
| GET | `/api/schedule` | List scheduled posts |
| DELETE | `/api/schedule/<id>` | Cancel scheduled post |
| GET | `/api/events?since=` | Real-time events |

---

# 📈 System Workflow

1. User Authentication
2. Platform Connection
3. Ad Creation
4. Media Upload
5. API-based Publishing
6. Real-time Status Tracking
7. Analytics & Reporting

---

# 🔮 Future Enhancements

- AI-based Ad Content Generation
- Campaign Performance Prediction
- Advanced Audience Targeting
- Social Media Insights Dashboard
- Mobile Application Support
- Multi-user Team Collaboration

---

# 👨‍💻 Developed For

Unified Multi-Platform Social Media Advertisement Publishing & Campaign Management using Python, Flask, APIs, and Automation.

---
