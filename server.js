const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = 5000;

// เปิด CORS เพื่อให้ frontend เรียกใช้ได้
app.use(cors());
app.use(express.json());

// ตั้งค่าเชื่อมต่อ PostgreSQL
const pool = new Pool({
    host: '10.4.1.40',
    port: 5432,
    database: 'postgres',
    user: 'user_beta',
    password: 'hello#mas',
    ssl: false // ถ้า server ต้องการ SSL ให้เปลี่ยนเป็น true
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
