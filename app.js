const { createApp, ref, onMounted } = Vue;

createApp({
    setup() {
        const title = ref('DeepEcoScan');
        const selectedFile = ref(null);
        const isLoading = ref(false);
        const uploadResult = ref(null);
        const uploadedFiles = ref([]);
        const currentUser = ref('');

        // Will update when live
        const API_URL = '/api'; 

        const loadFileList = async () => {
            try {
                const response = await fetch(`${API_URL}/files`);
                
                // If traefik session is expired or user is not authenticated, trigger the auth flow
                if (response.status === 401 || response.status === 403) {
                    window.location.reload(); // Trigger Traefik auth redirect
                    return;
                }

                const data = await response.json();
                uploadedFiles.value = data.files;
                currentUser.value = data.currentUser;
            } catch (error) {
                console.error('Auth or Connection Error:', error);
            }
        };

        
        const login = () => {
            window.location.href = '/upload.html'; 
        };

        
        const logout = () => {
            window.location.href = '/_oauth/logout'; 
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
                uploadResult.value = { success: true, message: data.message };
                await loadFileList();
            } catch (error) {
                uploadResult.value = { success: false, message: 'Upload failed' };
            } finally {
                isLoading.value = false;
                selectedFile.value = null;
            }
        };

        onMounted(loadFileList);

        return {
            title, selectedFile, isLoading, uploadResult,
            uploadedFiles, currentUser, login, logout, uploadFile
           
        };
    },
}).mount('#app');