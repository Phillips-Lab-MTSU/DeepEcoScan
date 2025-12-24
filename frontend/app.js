const { createApp, ref, onMounted } = Vue;

createApp({
    setup() {
        const title = ref('DeepEcoScan');
        
        // --- NEW: Auth State ---
        const isLoggedIn = ref(false); 

        const selectedFile = ref(null);
        const isLoading = ref(false);
        const uploadResult = ref(null);
        const isDragover = ref(false);
        const uploadedFiles = ref([]);
        const fileInput = ref(null);

        const API_URL = 'http://localhost:3000';

        // --- NEW: Auth Methods ---
        const login = () => {
            isLoggedIn.value = true;
            // Fetch files immediately after "logging in"
            loadFileList();
        };

        const logout = () => {
            isLoggedIn.value = false;
            // Clear sensitive data on logout if necessary
            selectedFile.value = null;
            uploadResult.value = null;
        };

        const loadFileList = async () => {
            // Only fetch if we are logged in
            if (!isLoggedIn.value) return;
            
            try {
                const response = await fetch(`${API_URL}/files`);
                const data = await response.json();
                if(data.files){
                    uploadedFiles.value = data.files;
                }
            } catch (error) {
                console.error('Error fetching file list:', error);
            }
        };

        const triggerFileInput = () => {
            fileInput.value.click();
        };
        
        const handleFileSelect = (event) => {
            const file = event.target.files[0];
            if (file) {
                selectedFile.value = file;
                uploadResult.value = null;
            }
        };

        const uploadFile = async () => {
            if (!selectedFile.value) return;

            isLoading.value = true;
            uploadResult.value = null;

            const formData = new FormData();
            formData.append('sequenceFile', selectedFile.value);

            try {
                const response = await fetch(`${API_URL}/upload`, {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Upload failed');
                }

                uploadResult.value = {
                    success: true,
                    message: 'Upload successful',
                    details: data,
                };
                await loadFileList();
            } catch (error) {
                uploadResult.value = {
                    success: false,
                    message: error.message || 'Upload failed'
                };
            } finally {
                isLoading.value = false;
                selectedFile.value = null;
                if (fileInput.value) fileInput.value.value = '';
            }
        };

        const handleDragover = () => {
            isDragover.value = true;
        };

        const handleDragleave = () => {
            isDragover.value = false;
        };

        const handleDrop = (event) => {
            isDragover.value = false;
            const file = event.dataTransfer.files[0];
            if (file) {
                selectedFile.value = file;
                uploadResult.value = null;
            }
        };

        onMounted(() => {
            // If you want it to remember login via localStorage, you'd check that here
            if (isLoggedIn.value) {
                loadFileList();
            }
        });

        return {
            title,
            isLoggedIn, 
            login,       
            logout,      
            selectedFile,
            isLoading,
            isDragover,
            uploadResult,
            uploadedFiles,
            fileInput,
            triggerFileInput,
            handleFileSelect,
            uploadFile,
            handleDragover,
            handleDragleave,
            handleDrop
        };
    },
}).mount('#app');