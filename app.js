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
        const isLoggedIn = ref(localStorage.getItem('isLoggedIn') === 'true');
        const currentUser = ref(localStorage.getItem('currentUser') || '');
        // const isLoggedIn = ref(false);
        // const currentUser = ref('');
        const fileInput = ref(null);

        // --- Project State ---
        const projects = ref([]); 
        const selectedProjectId = ref(null); 
        const newProjectName = ref(''); 


        const API_URL = 'https://deepeco.local:8081';

        /*
        const checkAuth = async () => {
            try {
                // We call the files endpoint; if it returns 200, we are authenticated
                const response = await fetch(`${API_URL}/files`);
                if (response.ok) {
                    const data = await response.json();
                    isLoggedIn.value = true;
                    currentUser.value = data.currentUser;
                    return true;
                }
                isLoggedIn.value = false;
                return false;
            } catch (error) {
                isLoggedIn.value = false;
                return false;
            } finally {
                isLoading.value = false;
            }
        };

        const logout = () => {
            localStorage.removeItem('isLoggedIn'); //will need to remove for traefik
            isLoggedIn.value = false;
            window.location.href = 'index.html';
        };

        onMounted(async () => {
            const authenticated = await checkAuth();
            if (authenticated) {
                // Only fetch data if Traefik confirmed our identity
                loadFileList();
                // fetchProjects(); // Uncomment if you have this implemented
            } else {
                // If not logged in, Traefik will usually redirect automatically,
                // but we can handle a fallback here.
                console.log("Not logged in.");
            }
        });

         */

        // --- Project Methods ---

        const fetchProjects = async () => {
            if (!isLoggedIn.value) return;

            try {
                const response = await fetch(`${API_URL}/api/projects`);
                if (response.status === 401 || response.status === 403) return;
                
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
                    body: JSON.stringify({ name: newProjectName.value.trim() })
                });

                const data = await response.json();

                if (!response.ok) throw new Error(data.error || 'Project creation failed');

                // Refresh list and auto-select the new project ID returned from DB
                await fetchProjects();
                selectedProjectId.value = data.project.id; 
                newProjectName.value = ''; 
                uploadResult.value = { success: true, message: 'Project created! You can now upload files.' };
            } catch (error) {
                uploadResult.value = { success: false, message: error.message };
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
            }
        };

        // --- API Methods ---

        const loadFileList = async () => {
            if (!isLoggedIn.value) return; 

            try {
                const response = await fetch(`${API_URL}/api/files`);
                if (response.status === 401 || response.status === 403) return;
                
                const data = await response.json();
                uploadedFiles.value = data.files || [];
                if (data.currentUser) currentUser.value = data.currentUser;
            } catch (error) {
                console.error('Connection Error:', error);
            }
        };

        const pollJobStatus = async (jobId) => {
            const interval = setInterval(async () => {
                try {
                    const response = await fetch(`${API_URL}/api/jobs/${jobId}`);
                    const data = await response.json();

                    if (!response.ok) throw new Error(data.error || 'Could not fetch job');

                    const job = data.job;

                    if (job.status === 'prep_running') {
                        uploadResult.value = { success: true, message: 'Running data prep...' };
                    } else if (job.status === 'prep_done') {
                        uploadResult.value = { success: true, message: 'Data prep complete. Starting embeddings...' };
                    } else if (job.status === 'embed_running') {
                        uploadResult.value = { success: true, message: 'Running dummy embedding job on CPU...' };
                    } else if (job.status === 'completed') {
                        uploadResult.value = { success: true, message: 'Pipeline complete.' };
                        clearInterval(interval);
                        await loadFileList();
                    } else if (job.status === 'failed') {
                        uploadResult.value = { success: false, message: job.errorMessage || 'Pipeline failed.' };
                        clearInterval(interval);
                        await loadFileList();
                    }
                } catch (error) {
                    clearInterval(interval);
                    uploadResult.value = { success: false, message: error.message || 'Status polling failed.' };
                }
            }, 2000);
        };

        const uploadFile = async () => {
            if (!selectedFile.value) return;

            // Ensure a real project is selected (not "new" or null)
            // if (!selectedProjectId.value || selectedProjectId.value === 'new') {
            //     uploadResult.value = { 
            //         success: false, 
            //         message: 'Please select or save a project before beginning the scan.' 
            //     };
            //     return;
            // }

            isLoading.value = true;
            uploadResult.value = null;

            const formData = new FormData();
            formData.append('sequenceFile', selectedFile.value);
            // formData.append('projectId', selectedProjectId.value);

            try {
                const response = await fetch(`${API_URL}/api/upload`, {
                    method: 'POST',
                    body: formData
                });
        
                const data = await response.json();

                if (!response.ok) throw new Error(data.error || 'Upload failed');
                
                uploadResult.value = { success: true, message: data.message || 'Upload successful!' };

                if (data.jobId) {
                    pollJobStatus(data.jobId);
                } else {
                    await loadFileList();
                }
            } catch (error) {
                uploadResult.value = { success: false, message: error.message || 'Upload failed.' };
            } finally {
                isLoading.value = false;
                selectedFile.value = null;
                if (fileInput.value) fileInput.value.value = '';
            }
        };

        // --- Auth Methods ---
        //will need to remove for traefik

        const logout = () => {
            localStorage.removeItem('isLoggedIn'); 
            isLoggedIn.value = false;
            window.location.href = 'index.html';
        };

        onMounted(() => {
            fetchProjects();
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