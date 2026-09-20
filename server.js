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
        : false,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
    idleTimeoutMillis: 30000
});

pool.on("error", error => {
    console.error("Erreur de connexion PostgreSQL:", error.message);
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
            "image/png"
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

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "img-src": ["'self'", "data:", "blob:"]
        }
    }
}));

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

    const requiredEnvironment = [
        "DATABASE_URL",
        "ADMIN_USERNAME",
        "ADMIN_PASSWORD"
    ];

    if (process.env.NODE_ENV === "production") {
        requiredEnvironment.push(
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY"
        );
    }

    const missingEnvironment = requiredEnvironment.filter(name => !process.env[name]);
    if (missingEnvironment.length > 0) {
        throw new Error(`Variables d'environnement manquantes: ${missingEnvironment.join(", ")}`);
    }

    if (process.env.NODE_ENV === "production" && !supabase) {
        throw new Error(
            "SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont obligatoires en production."
        );
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
            photo_filename TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        ALTER TABLE participants
        ALTER COLUMN photo_filename DROP NOT NULL
    `);

    await pool.query(`
        ALTER TABLE participants
        ALTER COLUMN age DROP NOT NULL,
        ALTER COLUMN classe DROP NOT NULL
    `);

    const ficheColumns = [
        ["telephone", "VARCHAR(50)"],
        ["email", "VARCHAR(255)"],
        ["date_naissance", "TEXT"],
        ["lieu_naissance", "TEXT"],
        ["sexe", "TEXT"],
        ["nationalite", "TEXT"],
        ["situation_matrimoniale", "TEXT"],
        ["adresse", "TEXT"],
        ["ville", "TEXT"],
        ["niveau_etudes", "TEXT"],
        ["dernier_diplome", "TEXT"],
        ["etablissement", "TEXT"],
        ["specialite", "TEXT"],
        ["annee_obtention", "TEXT"],
        ["contact_nom", "TEXT"],
        ["contact_lien", "TEXT"],
        ["contact_telephone", "TEXT"]
    ];

    const existingColumns = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'participants'
    `);
    const columnNames = new Set(existingColumns.rows.map(row => row.column_name));

    for (const [columnName, definition] of ficheColumns) {
        if (!columnNames.has(columnName)) {
            await pool.query(`ALTER TABLE participants ADD COLUMN ${columnName} ${definition}`);
        }
    }

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

        let uploadedStoragePath = null;

        try {

            const nom = String(req.body.nom || "").trim();
            const prenom = String(req.body.prenom || "").trim();
            const telephone = String(req.body.telephone || "").trim();

            if (!nom || !prenom || !telephone) {

                return res.status(400).json({
                    message: "Le nom, les prénoms et le téléphone sont obligatoires."
                });
            }

            let photoFilename = null;

            if (req.file) {
                const extension = path.extname(req.file.originalname).toLowerCase();
                const filename =
                    `${Date.now()}-${Math.random().toString(36).substring(2)}${extension}`;

                if (!supabase) {
                    throw new Error("Photo upload failed: Supabase Storage indisponible.");
                }

                const { error } = await supabase.storage
                    .from(PHOTO_BUCKET)
                    .upload(filename, req.file.buffer, {
                        contentType: req.file.mimetype,
                        upsert: false
                    });

                if (error) {
                    throw new Error(`Photo upload failed: ${error.message}`);
                }

                uploadedStoragePath = filename;
                photoFilename = `storage:${filename}`;
            }

            const fiche = {
                email: String(req.body.email || "").trim(),
                date_naissance: String(req.body.date_naissance || "").trim(),
                lieu_naissance: String(req.body.lieu_naissance || "").trim(),
                sexe: String(req.body.sexe || "").trim(),
                nationalite: String(req.body.nationalite || "").trim(),
                situation_matrimoniale: String(req.body.situation_matrimoniale || "").trim(),
                adresse: String(req.body.adresse || "").trim(),
                ville: String(req.body.ville || "").trim(),
                niveau_etudes: String(req.body.niveau_etudes || "").trim(),
                dernier_diplome: String(req.body.dernier_diplome || "").trim(),
                etablissement: String(req.body.etablissement || "").trim(),
                specialite: String(req.body.specialite || "").trim(),
                annee_obtention: String(req.body.annee_obtention || "").trim(),
                contact_nom: String(req.body.contact_nom || "").trim(),
                contact_lien: String(req.body.contact_lien || "").trim(),
                contact_telephone: String(req.body.contact_telephone || "").trim()
            };

            const result = await pool.query(
                `
                INSERT INTO participants
                (nom, prenom, telephone, email, date_naissance, lieu_naissance,
                 sexe, nationalite, situation_matrimoniale, adresse, ville,
                 niveau_etudes, dernier_diplome, etablissement, specialite,
                 annee_obtention, contact_nom, contact_lien, contact_telephone,
                 photo_filename)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                        $13, $14, $15, $16, $17, $18, $19, $20)
                RETURNING id
                `,
                [
                    nom,
                    prenom,
                    telephone,
                    fiche.email,
                    fiche.date_naissance,
                    fiche.lieu_naissance,
                    fiche.sexe,
                    fiche.nationalite,
                    fiche.situation_matrimoniale,
                    fiche.adresse,
                    fiche.ville,
                    fiche.niveau_etudes,
                    fiche.dernier_diplome,
                    fiche.etablissement,
                    fiche.specialite,
                    fiche.annee_obtention,
                    fiche.contact_nom,
                    fiche.contact_lien,
                    fiche.contact_telephone,
                    photoFilename
                ]
            );

            res.status(201).json({
                success: true,
                message: "Inscription enregistrée.",
                id: result.rows[0].id
            });

        } catch (error) {

            if (uploadedStoragePath && supabase) {
                await supabase.storage
                    .from(PHOTO_BUCKET)
                    .remove([uploadedStoragePath])
                    .catch(cleanupError => console.error(
                        "Erreur nettoyage photo:",
                        cleanupError
                    ));
            }

            console.error(error);

            res.status(500).json({
                message: error.message.startsWith("Photo upload failed")
                    ? error.message
                    : "Impossible d'enregistrer l'inscription."
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
                    telephone,
                    email,
                    date_naissance,
                    lieu_naissance,
                    sexe,
                    nationalite,
                    situation_matrimoniale,
                    adresse,
                    ville,
                    niveau_etudes,
                    dernier_diplome,
                    etablissement,
                    specialite,
                    annee_obtention,
                    contact_nom,
                    contact_lien,
                    contact_telephone,
                    photo_filename,
                    created_at
                FROM participants
                ORDER BY LOWER(nom), LOWER(prenom), id
            `);

            const participants = result.rows.map(participant => {
                const {
                    photo_filename: photoFilename,
                    ...publicParticipant
                } = participant;

                return {
                    ...publicParticipant,
                    has_photo: Boolean(photoFilename),
                    photo_url: photoFilename ? `/api/admin/photo/${participant.id}` : null
                };
            });

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

            if (filename && filename.startsWith("storage:")) {
                const storagePath = filename.slice("storage:".length);
                const { data, error } = await supabase.storage
                    .from(PHOTO_BUCKET)
                    .download(storagePath);

                if (error || !data) {
                    return res.status(404).send("Photo introuvable.");
                }

                const buffer = Buffer.from(await data.arrayBuffer());
                res.type(path.extname(storagePath));
                return res.send(buffer);
            }

            if (!filename) {
                return res.status(404).send("Aucune photo.");
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

            if (filename && filename.startsWith("storage:")) {
                const storagePath = filename.slice("storage:".length);
                const { error } = await supabase.storage
                    .from(PHOTO_BUCKET)
                    .remove([storagePath]);

                if (error) {
                    throw error;
                }
            } else if (filename && fs.existsSync(path.join(uploadDir, filename))) {
                const filepath = path.join(uploadDir, filename);
                fs.unlinkSync(filepath);
            }

            await pool.query(
                "DELETE FROM participants WHERE id = $1",
                [req.params.id]
            );

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
                    telephone,
                    email,
                    date_naissance,
                    lieu_naissance,
                    sexe,
                    nationalite,
                    situation_matrimoniale,
                    adresse,
                    ville,
                    niveau_etudes,
                    dernier_diplome,
                    etablissement,
                    specialite,
                    annee_obtention,
                    contact_nom,
                    contact_lien,
                    contact_telephone,
                    created_at
                FROM participants
                ORDER BY LOWER(nom), LOWER(prenom), id
            `);

            const headers = [
                "ID", "Nom", "Prénoms", "Téléphone", "E-mail",
                "Date de naissance", "Lieu de naissance", "Sexe", "Nationalité",
                "Situation matrimoniale", "Adresse", "Ville / Commune",
                "Niveau d'études", "Dernier diplôme", "Établissement",
                "Filière / Spécialité", "Année d'obtention", "Personne à contacter",
                "Lien", "Téléphone du contact", "Date d'enregistrement"
            ];

            let csv = `${headers.join(",")}\n`;

            for (const p of result.rows) {
                const values = [
                    p.id,
                    p.nom,
                    p.prenom,
                    p.telephone,
                    p.email,
                    p.date_naissance,
                    p.lieu_naissance,
                    p.sexe,
                    p.nationalite,
                    p.situation_matrimoniale,
                    p.adresse,
                    p.ville,
                    p.niveau_etudes,
                    p.dernier_diplome,
                    p.etablissement,
                    p.specialite,
                    p.annee_obtention,
                    p.contact_nom,
                    p.contact_lien,
                    p.contact_telephone,
                    p.created_at ? new Date(p.created_at).toISOString() : ""
                ].map(value => `"${String(value ?? "").replace(/"/g, '""')}"`);

                csv += `${values.join(",")}\n`;
            }

            res.setHeader(
                "Content-Type",
                "text/csv; charset=utf-8"
            );

            res.setHeader(
                "Content-Disposition",
                'attachment; filename="fiches-renseignements.csv"'
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

app.use((error, req, res, next) => {

    if (error instanceof multer.MulterError || String(error.message || "").includes("Format d'image")) {
        return res.status(400).json({
            message: error.message
        });
    }

    if (error) {
        console.error(error);
        return res.status(500).json({
            message: "Erreur serveur."
        });
    }

    next();
});

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