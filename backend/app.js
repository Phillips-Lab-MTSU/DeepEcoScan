const { createApp, ref, onMounted } = Vue;

createApp({
    setup() {
        const title = ref('DeepEcoScan');
        const selectedFile = ref(null);
        const isLoading = ref(false);
        const uploadResult = ref(null);
        const isDragover = ref(false);
        const uploadedFiles = ref([]);
        const fileInput = ref(null);


        const API_URL = window.location.origin;

        const loadFileList = async () => {
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
                fileInput.value.value = '';
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
            loadFileList();
        });

        return {
            title,
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

