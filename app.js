const { createApp, ref, onMounted } = Vue;

createApp({
    setup() {
        const title = ref('DeepEcoScan');
        const selectedFile = ref(null);
        const isLoading = ref(false);
        const uploadResult = ref(null);
        const uploadedFiles = ref([]);
        const currentUser = ref('');

        // 1. Logic Shift: API_URL is relative because we are behind the same Traefik Host
        const API_URL = '/api'; // Assuming Traefik routes /api to your backend

        const loadFileList = async () => {
            try {
                const response = await fetch(`${API_URL}/files`);
                
                // 2. If Traefik session expired, handle the 401/407
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

        // 3. Traefik handles the login wall. The "Login" button just points to 
        // a protected route that triggers the middleware.
        const login = () => {
            window.location.href = '/upload.html'; 
        };

        // 4. Logout needs to hit the ForwardAuth logout endpoint 
        // (usually provided by traefik-forward-auth or your OIDC provider)
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
            // ... (other handlers like triggerFileInput remain the same)
        };
    },
}).mount('#app');