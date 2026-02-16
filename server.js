const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = parseInt(process.env.PORT || '5000', 10);

// เปิด CORS เพื่อให้ frontend เรียกใช้ได้
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/config.js', (req, res) => {
    res.type('application/javascript');
    const webhookUrl = process.env.N8N_WEBHOOK_URL || '';
    res.send(`window.__WEBHOOK_URL = ${JSON.stringify(webhookUrl)};`);
});

// ตั้งค่าเชื่อมต่อ PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: (process.env.DB_SSL || 'false') === 'true'
});

// API endpoint สำหรับดึงคำถามจากตาราง faq
app.get('/api/faq', async (req, res) => {
    try {
        const result = await pool.query('SELECT question FROM faq LIMIT 3');
        const questions = result.rows.map(row => row.question);
        res.json({ success: true, questions });
    } catch (error) {
        console.error('Database Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ทดสอบ API
app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working!' });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
