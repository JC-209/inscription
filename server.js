require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const PHOTO_BUCKET = process.env.SUPABASE_PHOTO_BUCKET || "participant-photos";

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    : null;

if (!JWT_SECRET) {
    console.error("JWT_SECRET manquant dans .env");
    process.exit(1);
}

/* =========================
   BASE DE DONNÉES
========================= */

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
});

/* =========================
   DOSSIER PHOTOS
========================= */

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

/* =========================
   MULTER
========================= */

const storage = multer.memoryStorage();

const upload = multer({
    storage,

    limits: {
        fileSize: 5 * 1024 * 1024
    },

    fileFilter: function (req, file, cb) {

        const allowed = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (!allowed.includes(file.mimetype)) {
            return cb(new Error("Format d'image non autorisé."));
        }

        cb(null, true);
    }
});

/* =========================
   MIDDLEWARE
========================= */

app.use(helmet());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 200,
        standardHeaders: true,
        legacyHeaders: false
    })
);

/* =========================
   FICHIERS PUBLICS
========================= */

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public.html"));
});

app.get("/style.css", (req, res) => {
    res.sendFile(path.join(__dirname, "public.css"));
});

app.get("/script.js", (req, res) => {
    res.sendFile(path.join(__dirname, "public.js"));
});

app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/admin/dashboard", (req, res) => {
    res.sendFile(path.join(__dirname, "admindashboard.html"));
});

app.get("/admin.css", (req, res) => {
    res.sendFile(path.join(__dirname, "admin.css"));
});

app.get("/admin.js", (req, res) => {
    res.sendFile(path.join(__dirname, "admin.js"));
});

app.use(
    "/admin",
    express.static(
        path.join(__dirname, "admin")
    )
);

/* =========================
   INITIALISATION DB
========================= */

async function initDatabase() {

    if (process.env.NODE_ENV === "production" && !supabase) {
        throw new Error(
            "SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont obligatoires en production."
        );
    }

    if (supabase) {
        const { error } = await supabase.storage.createBucket(
            PHOTO_BUCKET,
            { public: false }
        );

        if (error && !error.message.toLowerCase().includes("already exists")) {
            throw error;
        }
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS admins (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS participants (
            id SERIAL PRIMARY KEY,
            nom VARCHAR(100) NOT NULL,
            prenom VARCHAR(100) NOT NULL,
            age INTEGER NOT NULL,
            classe VARCHAR(100) NOT NULL,
            photo_filename TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const admin = await pool.query(
        "SELECT id FROM admins WHERE username = $1",
        [process.env.ADMIN_USERNAME]
    );

    if (admin.rows.length === 0) {

        const passwordHash = await bcrypt.hash(
            process.env.ADMIN_PASSWORD,
            12
        );

        await pool.query(
            `
            INSERT INTO admins
            (username, password_hash)
            VALUES ($1, $2)
            `,
            [
                process.env.ADMIN_USERNAME,
                passwordHash
            ]
        );

        console.log("Compte administrateur créé.");
    }
}

/* =========================
   AUTHENTIFICATION ADMIN
========================= */

function authenticateAdmin(req, res, next) {

    const header = req.headers.authorization;

    if (!header) {
        return res.status(401).json({
            message: "Non autorisé."
        });
    }

    const token = header.replace("Bearer ", "");

    try {

        const decoded = jwt.verify(
            token,
            JWT_SECRET
        );

        req.admin = decoded;

        next();

    } catch {

        return res.status(401).json({
            message: "Session expirée."
        });
    }
}

/* =========================
   CONNEXION ADMIN
========================= */

app.post("/api/admin/login", async (req, res) => {

    try {

        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                message: "Identifiants incomplets."
            });
        }

        const result = await pool.query(
            "SELECT * FROM admins WHERE username = $1",
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                message: "Identifiants incorrects."
            });
        }

        const admin = result.rows[0];

        const valid = await bcrypt.compare(
            password,
            admin.password_hash
        );

        if (!valid) {
            return res.status(401).json({
                message: "Identifiants incorrects."
            });
        }

        const token = jwt.sign(
            {
                id: admin.id,
                username: admin.username
            },
            JWT_SECRET,
            {
                expiresIn: "8h"
            }
        );

        res.json({
            success: true,
            token
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Erreur serveur."
        });
    }
});

/* =========================
   INSCRIPTION
========================= */

app.post(
    "/api/participants",
    upload.single("photo"),
    async (req, res) => {

        try {

            const {
                nom,
                prenom,
                age,
                classe
            } = req.body;

            if (!nom || !prenom || !age || !classe) {

                return res.status(400).json({
                    message: "Tous les champs sont obligatoires."
                });
            }

            if (!req.file) {

                return res.status(400).json({
                    message: "La photo est obligatoire."
                });
            }

            const ageNumber = Number(age);

            if (
                !Number.isInteger(ageNumber) ||
                ageNumber < 1 ||
                ageNumber > 120
            ) {

                return res.status(400).json({
                    message: "Âge invalide."
                });
            }

            const extension = path.extname(req.file.originalname).toLowerCase();
            const filename =
                `${Date.now()}-${Math.random().toString(36).substring(2)}${extension}`;

            let photoFilename = filename;

            if (supabase) {
                const { error } = await supabase.storage
                    .from(PHOTO_BUCKET)
                    .upload(filename, req.file.buffer, {
                        contentType: req.file.mimetype,
                        upsert: false
                    });

                if (error) {
                    throw error;
                }

                photoFilename = `storage:${filename}`;
            } else {
                fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);
            }

            const result = await pool.query(
                `
                INSERT INTO participants
                (nom, prenom, age, classe, photo_filename)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
                `,
                [
                    nom.trim(),
                    prenom.trim(),
                    ageNumber,
                    classe.trim(),
                    photoFilename
                ]
            );

            res.status(201).json({
                success: true,
                message: "Inscription enregistrée.",
                id: result.rows[0].id
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message: "Impossible d'enregistrer l'inscription."
            });
        }
    }
);

/* =========================
   STATISTIQUES ADMIN
========================= */

app.get(
    "/api/admin/stats",
    authenticateAdmin,
    async (req, res) => {

        try {

            const result = await pool.query(
                "SELECT COUNT(*) FROM participants"
            );

            res.json({
                total: Number(result.rows[0].count)
            });

        } catch {

            res.status(500).json({
                message: "Erreur serveur."
            });
        }
    }
);

/* =========================
   LISTE PARTICIPANTS
========================= */

app.get(
    "/api/admin/participants",
    authenticateAdmin,
    async (req, res) => {

        try {

            const result = await pool.query(`
                SELECT
                    id,
                    nom,
                    prenom,
                    age,
                    classe,
                    photo_filename,
                    created_at
                FROM participants
                ORDER BY LOWER(nom), LOWER(prenom), id
            `);

            const participants = await Promise.all(
                result.rows.map(async participant => {

                    const {
                        photo_filename: photoFilename,
                        ...publicParticipant
                    } = participant;

                    if (!photoFilename.startsWith("storage:")) {
                        return publicParticipant;
                    }

                    const storagePath = photoFilename.slice("storage:".length);
                    const { data } = await supabase.storage
                        .from(PHOTO_BUCKET)
                        .createSignedUrl(storagePath, 3600);

                    return {
                        ...publicParticipant,
                        photo_url: data?.signedUrl || null
                    };
                })
            );

            res.json(participants);

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message: "Erreur serveur."
            });
        }
    }
);

/* =========================
   PHOTO PRIVÉE
========================= */

app.get(
    "/api/admin/photo/:id",
    authenticateAdmin,
    async (req, res) => {

        try {

            const result = await pool.query(
                `
                SELECT photo_filename
                FROM participants
                WHERE id = $1
                `,
                [req.params.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).send("Photo introuvable.");
            }

            const filename =
                result.rows[0].photo_filename;

            if (filename.startsWith("storage:")) {
                const storagePath = filename.slice("storage:".length);
                const { data, error } = await supabase.storage
                    .from(PHOTO_BUCKET)
                    .createSignedUrl(storagePath, 60);

                if (error || !data?.signedUrl) {
                    return res.status(404).send("Photo introuvable.");
                }

                return res.redirect(data.signedUrl);
            }

            const filepath =
                path.join(uploadDir, filename);

            if (!fs.existsSync(filepath)) {
                return res.status(404).send("Photo introuvable.");
            }

            res.sendFile(filepath);

        } catch {

            res.status(500).send("Erreur serveur.");
        }
    }
);

/* =========================
   SUPPRESSION
========================= */

app.delete(
    "/api/admin/participants/:id",
    authenticateAdmin,
    async (req, res) => {

        try {

            const result = await pool.query(
                `
                SELECT photo_filename
                FROM participants
                WHERE id = $1
                `,
                [req.params.id]
            );

            if (result.rows.length === 0) {

                return res.status(404).json({
                    message: "Participant introuvable."
                });
            }

            const filename =
                result.rows[0].photo_filename;

            await pool.query(
                "DELETE FROM participants WHERE id = $1",
                [req.params.id]
            );

            const filepath =
                path.join(uploadDir, filename);

            if (filename.startsWith("storage:")) {
                const storagePath = filename.slice("storage:".length);
                const { error } = await supabase.storage
                    .from(PHOTO_BUCKET)
                    .remove([storagePath]);

                if (error) {
                    throw error;
                }
            } else if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }

            res.json({
                success: true
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message: "Erreur lors de la suppression."
            });
        }
    }
);

/* =========================
   EXPORT CSV
========================= */

app.get(
    "/api/admin/export",
    authenticateAdmin,
    async (req, res) => {

        try {

            const result = await pool.query(`
                SELECT
                    id,
                    nom,
                    prenom,
                    age,
                    classe,
                    created_at
                FROM participants
                ORDER BY LOWER(nom), LOWER(prenom), id
            `);

            let csv =
                "ID,Nom,Prénom,Âge,Classe,Date\n";

            for (const p of result.rows) {

                csv += [
                    p.id,
                    `"${String(p.nom).replace(/"/g, '""')}"`,
                    `"${String(p.prenom).replace(/"/g, '""')}"`,
                    p.age,
                    `"${String(p.classe).replace(/"/g, '""')}"`,
                    p.created_at.toISOString()
                ].join(",") + "\n";
            }

            res.setHeader(
                "Content-Type",
                "text/csv; charset=utf-8"
            );

            res.setHeader(
                "Content-Disposition",
                'attachment; filename="participants.csv"'
            );

            res.send(csv);

        } catch {

            res.status(500).send(
                "Impossible de générer le fichier."
            );
        }
    }
);

/* =========================
   LANCEMENT
========================= */

initDatabase()
    .then(() => {

        app.listen(PORT, "0.0.0.0", () => {

            console.log(
                `Serveur lancé sur le port ${PORT}`
            );

        });

    })
    .catch(error => {

        console.error(
            "Erreur initialisation DB:",
            error
        );

        process.exit(1);
    });