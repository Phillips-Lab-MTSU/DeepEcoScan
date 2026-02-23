const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const UPLOAD_DIR = 'temp_uploads';

if (!fs.existsSync(UPLOAD_DIR)){
    fs.mkdirSync(UPLOAD_DIR);
}

// Identify the user from Traefik headers

const getAuthenticatedUser = (req) => req.headers['x-forwarded-user'] || 'anonymous';

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const user = getAuthenticatedUser(req);
        // Prefixing with user identity to keep uploads separate/identifiable
        cb(null, `${user}-${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        ['.fasta', '.fastq', '.fq', '.fa'].includes(ext) 
            ? cb(null, true) 
            : cb(new Error('Invalid format'), false);
    }
});

app.get('/files', (req, res) => {
    const user = getAuthenticatedUser(req);
    fs.readdir(UPLOAD_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Read error' });
        
        // Filter files so users only see their own uploads
        const userFiles = files.filter(f => f.startsWith(user));
        res.status(200).json({ files: userFiles, currentUser: user });
    });
});

app.post('/upload', upload.single('sequenceFile'), (req, res) => {
    if (!req.file) return res.status(400).send('Upload failed.');
    res.status(200).send({ 
        message: 'Uploaded as ' + getAuthenticatedUser(req), 
        filename: req.file.filename 
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));