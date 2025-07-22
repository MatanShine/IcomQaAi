<?php
// Minimal PHP wrapper for a Hebrew chat app
?>
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>צ'אט תמיכה - ZebraCRM</title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            background: #f5f5f5;
            direction: rtl;
            text-align: right;
            margin: 0;
            padding: 0;
        }
        .chat-container {
            max-width: 500px;
            margin: 40px auto;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            padding: 24px;
        }
        .chat-log {
            min-height: 300px;
            max-height: 400px;
            overflow-y: auto;
            border: 1px solid #ddd;
            border-radius: 6px;
            padding: 12px;
            background: #fafafa;
            margin-bottom: 16px;
        }
        .chat-msg {
            margin-bottom: 12px;
        }
        .chat-msg.user {
            color: #0b5394;
            font-weight: bold;
        }
        .chat-msg.bot {
            color: #333;
        }
        .chat-input-row {
            display: flex;
            gap: 8px;
        }
        .chat-input {
            flex: 1;
            padding: 8px;
            font-size: 1em;
            border-radius: 4px;
            border: 1px solid #ccc;
        }
        .chat-send {
            padding: 8px 16px;
            font-size: 1em;
            background: #0b5394;
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .chat-send:disabled {
            background: #aaa;
            cursor: not-allowed;
        }
    </style>
</head>
<body>
<div class="chat-container">
    <h2>ברוכים הבאים לצ'אט התמיכה של ZebraCRM</h2>
    <div class="chat-log" id="chat-log"></div>
    <form id="chat-form" class="chat-input-row" autocomplete="off">
        <input type="text" id="chat-input" class="chat-input" placeholder="הקלד את ההודעה שלך..." required autofocus />
        <button type="submit" class="chat-send">שלח</button>
    </form>
</div>
<script>
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

function linkify(text) {
    // Regex to match URLs
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlPattern, function(url) {
        return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
}

function appendMessage(text, sender) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg ' + sender;
    if (sender === 'bot') {
        msgDiv.innerHTML = linkify(text);
    } else {
        msgDiv.textContent = text;
    }
    chatLog.appendChild(msgDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}

chatForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    const userMsg = chatInput.value.trim();
    if (!userMsg) return;
    appendMessage(userMsg, 'user');
    chatInput.value = '';
    appendMessage('...טוען תשובה', 'bot');
    try {
        const res = await fetch('http://localhost:5050/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMsg })
        });
        const data = await res.json();
        // Remove loading message
        chatLog.removeChild(chatLog.lastChild);
        if (data.response) {
            appendMessage(data.response, 'bot');
        } else {
            appendMessage('שגיאה בקבלת תשובה מהשרת.', 'bot');
        }
    } catch (err) {
        chatLog.removeChild(chatLog.lastChild);
        appendMessage('שגיאה בחיבור לשרת.', 'bot');
    }
});
</script>
</body>
</html> 