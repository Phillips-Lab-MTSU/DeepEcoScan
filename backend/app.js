const { createApp, ref, onMounted } = Vue;

createApp({
    setup() {
        // --- State Refs ---
        const title = ref('DeepEcoScan');
        const selectedFile = ref(null);
        const isLoading = ref(false);
        const uploadResult = ref(null);
        const uploadedFiles = ref([]);
        const isDragOver = ref(false);
        const isLoggedIn = ref(localStorage.getItem('isLoggedIn') === 'true');
        
        
        const currentUser = ref(localStorage.getItem('currentUser') || ''); // Initialize with empty string if not set
        
        
        const fileInput = ref(null);

        const API_URL = 'http://localhost:3000/api';

        // --- File Handling Methods ---

        const triggerFileInput = () => {
            if (fileInput.value) {
                fileInput.value.click();
            }
        };

        const handleFileSelect = (event) => {
            const files = event.target.files;
            if (files && files.length > 0) {
                selectedFile.value = files[0];
                uploadResult.value = null; 
            }
        };

        const handleDrop = (event) => {
            isDragOver.value = false;
            const files = event.dataTransfer.files;
            if (files && files.length > 0) {
                selectedFile.value = files[0];
            }
        };

        // --- API Methods ---

        const loadFileList = async () => {
            if (!isLoggedIn.value) return; 

            try {
                const response = await fetch(`${API_URL}/files`);
                if (response.status === 401 || response.status === 403) {
                    // Only reload if we actually expected to be logged in
                    return;
                }
                const data = await response.json();
                uploadedFiles.value = data.files || [];
                if (data.currentUser) currentUser.value = data.currentUser;
            } catch (error) {
                console.error('Connection Error:', error);
            }
        };

        const uploadFile = async () => {
            if (!selectedFile.value) return;
            isLoading.value = true;
            const formData = new FormData();
            formData.append('sequenceFile', selectedFile.value);

            try {
                const response = await fetch(`${API_URL}/upload`, {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();
                uploadResult.value = { success: true, message: data.message || 'Upload successful!' };
                await loadFileList();
            } catch (error) {
                uploadResult.value = { success: false, message: 'Upload failed. Please try again.' };
            } finally {
                isLoading.value = false;
                selectedFile.value = null;
            }
        };

        // --- Auth Methods ---

        const login = () => {
            localStorage.setItem('isLoggedIn', 'true');
            isLoggedIn.value = true;
            // Redirect to the loader page after login
            window.location.href = 'login.html';
        };

        const logout = () => {
            localStorage.removeItem('isLoggedIn');
            isLoggedIn.value = false;
            window.location.href = 'index.html';
        };

        onMounted(() => {
            // Check if we are on a page that has the file list (upload.html)
            // or just load it anyway, it will exit early if not logged in.
            loadFileList();
        });

        // --- Return to Template ---
        return {
            title, 
            selectedFile, 
            isLoading, 
            uploadResult,
            uploadedFiles, 
            currentUser,
            isDragOver, 
            isLoggedIn, 
            login, 
            logout,
            fileInput,
            triggerFileInput, 
            handleFileSelect, 
            handleDrop,
            uploadFile
        };
    },
}).mount('#app');