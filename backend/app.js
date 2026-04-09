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
        const fileInput = ref(null);

        // --- Project State ---
        const projects = ref([]); 
        const selectedProjectId = ref(null); 
        const newProjectName = ref(''); 


        const API_URL = 'http://deepeco.local:8081';

        // --- Project Methods ---

        const fetchProjects = async () => {
            if (!isLoggedIn.value) return;

            try {
                const response = await fetch(`${API_URL}/projects`);
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
                const response = await fetch(`${API_URL}/projects`, {
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
                const response = await fetch(`${API_URL}/files`);
                if (response.status === 401 || response.status === 403) return;
                
                const data = await response.json();
                uploadedFiles.value = data.files || [];
                if (data.currentUser) currentUser.value = data.currentUser;
            } catch (error) {
                console.error('Connection Error:', error);
            }
        };

        const uploadFile = async () => {
            if (!selectedFile.value) return;

            // Ensure a real project is selected (not "new" or null)
            if (!selectedProjectId.value || selectedProjectId.value === 'new') {
                uploadResult.value = { 
                    success: false, 
                    message: 'Please select or save a project before beginning the scan.' 
                };
                return;
            }

            isLoading.value = true;
            uploadResult.value = null;

            const formData = new FormData();
            formData.append('sequenceFile', selectedFile.value);
            formData.append('projectId', selectedProjectId.value);

            try {
                const response = await fetch(`${API_URL}/upload`, {
                    method: 'POST',
                    body: formData
                });
        
                const data = await response.json();

                if (!response.ok) throw new Error(data.error || 'Upload failed');
                
                uploadResult.value = { success: true, message: data.message || 'Upload successful!' };
                await loadFileList(); 
            } catch (error) {
                uploadResult.value = { success: false, message: error.message || 'Upload failed.' };
            } finally {
                isLoading.value = false;
                selectedFile.value = null;
                if (fileInput.value) fileInput.value.value = '';
            }
        };

        // --- Auth Methods ---

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