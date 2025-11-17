const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = 3000;
const UPLOAD_DIR = 'temp_uploads';

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)){
    fs.mkdirSync(UPLOAD_DIR);
    console.log(`Created upload directory at ${UPLOAD_DIR}`);
}

//Enable cross-origin resource sharing to allow the frontend to access the backend
app.use(cors());
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
     },
    filename: function (req, file, cb) {
        const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniquePrefix + '-' + file.originalname);
    }
});
// Configure multer for file uploads
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['.fasta', '.fastq', '.fq', '.fa'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Only FASTA and FASTQ files are allowed'), false);
    }
};

const upload = multer({ storage: storage, fileFilter: fileFilter });

// Endpoint to handle file uploads
app.post('/upload', upload.single('sequenceFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded or invalid file type.');
    }
    res.status(200).send({ message: 'File uploaded successfully', filename: req.file.filename });
});

//get endpoint to list uploaded files
app.get('/files', (req, res) => {
    fs.readdir(UPLOAD_DIR, (err, files) => {
        if (err) {
            console.error('Error reading upload directory:', err);
            return res.status(500).json({ error: 'Error reading upload directory' });
        }
        res.status(200).json({ files });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});