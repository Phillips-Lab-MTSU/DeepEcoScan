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

        const projects = ref([]); // New state for projects
        const selectedProjectId = ref(null); // State for selected project
        const newProjectName = ref(''); // State for new project name

        const API_URL = 'http://deepeco.local:8081';

        // --- File/Project Handling Methods ---

        const fetchProjects = async () => {
            if (!isLoggedIn.value) return;

            try {
                const response = await fetch(`${API_URL}/projects`);
                if (response.status === 401 || response.status === 403) {
                    return;
                }
                const data = await response.json();
                projects.value = data.projects || [];
            } catch (error) {
                console.error('Error fetching projects:', error);
            }
        };

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
            uploadResult.value = null; // Clear previous result

            // Validation: If "new" is selected, require a name
            if (selectedProjectId.value === 'new' && !newProjectName.value.trim()) {
                uploadResult.value = { success: false, message: 'Please enter a name for the new project.' };
                return;
            }

            const formData = new FormData();
            formData.append('sequenceFile', selectedFile.value);
            
            // Send project info to backend
            formData.append('projectId', selectedProjectId.value);
            if (selectedProjectId.value === 'new') {
                formData.append('projectName', newProjectName.value);
            }

            try {
                const response = await fetch(`${API_URL}/upload`, {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Upload failed');
                }
                
                uploadResult.value = { success: true, message: data.message || 'Upload successful!' };

                await loadFileList(); // Refresh file list after upload
            } catch (error) {
                uploadResult.value = { success: false, message: error.message || 'Upload failed. Please try again.' };
            } finally {
                isLoading.value = false;
                selectedFile.value = null; // Clear selected file after upload attempt
                if (fileInput.value) {
                    fileInput.value.value = ''; // Reset file input
                }
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
            uploadFile,
            projects,
            selectedProjectId,
            newProjectName
        };
    },
}).mount('#app');