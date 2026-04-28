const { createApp, ref, onMounted } = Vue;

createApp({
    setup() {
        // --- State ---
        const title = ref('DeepEcoScan');
        const selectedFile = ref(null);
        const isLoading = ref(false);
        const uploadResult = ref(null);
        const uploadedFiles = ref([]);
        const isDragOver = ref(false);
        const isLoggedIn = ref(false);
        const currentUser = ref('');
        const fileInput = ref(null);

        // --- Project State ---
        const projects = ref([]);
        const selectedProjectId = ref(null);
        const newProjectName = ref('');

        // --- Config ---
        const API_URL = 'https://deepeco.local:8081';

        // --- Auth Methods ---
        const login = () => {
            window.location.href = '/login.html';
        };

        const logout = () => {
            // For now this is a local app logout redirect.
            // If you later wire a real IdP logout endpoint, replace this.
            isLoggedIn.value = false;
            currentUser.value = '';
            uploadedFiles.value = [];
            projects.value = [];
            window.location.href = '/index.html';
        };

        const checkAuth = async () => {
            try {
                // Use a relative path so it routes through Traefik correctly
                const response = await fetch('/api/auth/status', {
                    credentials: 'include'
                });

                if (response.ok) {
                    const data = await response.json();
                    currentUser.value = data.user;
                    isLoggedIn.value = true;
                    return true;
                } else {
                    isLoggedIn.value = false;
                    return false;
                }
            } catch (error) {
                console.error('Auth check failed:', error);
                return false;
            }
        };

        // --- Project Methods ---
        const fetchProjects = async () => {
            if (!isLoggedIn.value) return;

            try {
                const response = await fetch(`${API_URL}/api/projects`, {
                    credentials: 'include'
                });

                if (response.status === 401 || response.status === 403 || response.status === 404) {
                    return;
                }

                const data = await response.json();
                projects.value = data.projects || [];
            } catch (error) {
                console.error('Error fetching projects:', error);
            }
        };

        const createProject = async () => {
            if (!newProjectName.value.trim()) return;

            isLoading.value = true;
            try {
                const response = await fetch(`${API_URL}/api/projects`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ name: newProjectName.value.trim() })
                });

                const data = await response.json();

                if (!response.ok) throw new Error(data.error || 'Project creation failed');

                await fetchProjects();
                selectedProjectId.value = data.project?.id || data.project?._id || null;
                newProjectName.value = '';
                uploadResult.value = {
                    success: true,
                    message: 'Project created! You can now upload files.'
                };
            } catch (error) {
                uploadResult.value = {
                    success: false,
                    message: error.message
                };
            } finally {
                isLoading.value = false;
            }
        };

        // --- File Handling Methods ---
        const triggerFileInput = () => {
            if (fileInput.value) fileInput.value.click();
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
                uploadResult.value = null;
            }
        };

        // --- API Methods ---
        const loadFileList = async () => {
            if (!isLoggedIn.value) return;

            try {
                const response = await fetch(`${API_URL}/api/files`, {
                    credentials: 'include'
                });

                if (response.status === 401 || response.status === 403) return;

                const data = await response.json();
                uploadedFiles.value = data.files || [];

                if (data.currentUser) {
                    currentUser.value = data.currentUser;
                }
            } catch (error) {
                console.error('Connection Error:', error);
            }
        };

        const pollJobStatus = async (jobId) => {
            const interval = setInterval(async () => {
                try {
                    const response = await fetch(`${API_URL}/api/jobs/${jobId}`, {
                        credentials: 'include'
                    });

                    const data = await response.json();

                    if (!response.ok) throw new Error(data.error || 'Could not fetch job');

                    const job = data.job;

                    if (job.status === 'prep_running') {
                        uploadResult.value = {
                            success: true,
                            message: 'Running data prep...'
                        };
                    } else if (job.status === 'prep_done') {
                        uploadResult.value = {
                            success: true,
                            message: 'Data prep complete. Starting embeddings...'
                        };
                    } else if (job.status === 'embed_running') {
                        uploadResult.value = {
                            success: true,
                            message: 'Running dummy embedding job on CPU...'
                        };
                    } else if (job.status === 'completed') {
                        uploadResult.value = {
                            success: true,
                            message: 'Pipeline complete.'
                        };
                        clearInterval(interval);
                        await loadFileList();
                    } else if (job.status === 'failed') {
                        uploadResult.value = {
                            success: false,
                            message: job.errorMessage || 'Pipeline failed.'
                        };
                        clearInterval(interval);
                        await loadFileList();
                    }
                } catch (error) {
                    clearInterval(interval);
                    uploadResult.value = {
                        success: false,
                        message: error.message || 'Status polling failed.'
                    };
                }
            }, 2000);
        };

        const uploadFile = async () => {
            if (!selectedFile.value) return;

            isLoading.value = true;
            uploadResult.value = null;

            const formData = new FormData();
            formData.append('sequenceFile', selectedFile.value);
            // formData.append('projectId', selectedProjectId.value);

            try {
                const response = await fetch(`${API_URL}/api/upload`, {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                });

                const data = await response.json();

                if (!response.ok) throw new Error(data.error || 'Upload failed');

                uploadResult.value = {
                    success: true,
                    message: data.message || 'Upload successful!'
                };

                if (data.jobId) {
                    pollJobStatus(data.jobId);
                } else {
                    await loadFileList();
                }
            } catch (error) {
                uploadResult.value = {
                    success: false,
                    message: error.message || 'Upload failed.'
                };
            } finally {
                isLoading.value = false;
                selectedFile.value = null;
                if (fileInput.value) fileInput.value.value = '';
            }
        };

        // --- Lifecycle ---
        onMounted(async () => {
            const authenticated = await checkAuth();
            if (authenticated) {
                await fetchProjects();
            }
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
            uploadFile,
            projects,
            selectedProjectId,
            newProjectName,
            createProject
        };
    },
}).mount('#app');