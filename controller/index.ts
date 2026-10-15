import express from "express";
import { conn } from "../dbconnect";

export const router = express.Router();

router.get('/', (req, res) => {
    res.send('Get in index.ts');
});

router.get('/health', async (req, res) => {
    try {
        await conn.query('SELECT 1');
        res.json({ status: 'ok' });
    } catch {
        res.status(503).json({ status: 'db_unavailable' });
    }
});
