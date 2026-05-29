document.addEventListener('DOMContentLoaded', () => {
    // Auth State
    let authToken = localStorage.getItem('rag_token') || null;
    let currentUser = JSON.parse(localStorage.getItem('rag_user')) || null;

    // Global UI Helpers
    window.showToast = function (message, type = 'success') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        container.appendChild(toast);

        // Trigger reflow for transition
        toast.offsetHeight;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    };

    // Global Confirm Helper
    window.showConfirm = function (message, title = '확인', confirmText = '확인', cancelText = '취소') {
        return new Promise((resolve) => {
            const modal = document.getElementById('global-confirm-modal');
            if (!modal) {
                // Fallback if modal is missing
                resolve(window.confirm(message));
                return;
            }

            document.getElementById('confirm-modal-title').textContent = title;
            document.getElementById('confirm-modal-message').textContent = message;
            const btnOk = document.getElementById('btn-global-confirm-ok');
            const btnCancel = document.getElementById('btn-global-confirm-cancel');

            btnOk.textContent = confirmText;
            btnCancel.textContent = cancelText;

            const handleOk = () => { cleanup(); resolve(true); };
            const handleCancel = () => { cleanup(); resolve(false); };

            const cleanup = () => {
                btnOk.removeEventListener('click', handleOk);
                btnCancel.removeEventListener('click', handleCancel);
                modal.classList.remove('active');
            };

            btnOk.addEventListener('click', handleOk);
            btnCancel.addEventListener('click', handleCancel);

            modal.classList.add('active');
        });
    };

    const loginApp = document.getElementById('login-app');
    const mainApp = document.getElementById('main-app');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const btnLogout = document.getElementById('btn-logout');
    const currentUsernameDisplay = document.getElementById('current-username');
    const navAdmin = document.getElementById('nav-admin');
    const adminArea = document.getElementById('admin-area');
    const navAgents = document.getElementById('nav-agents');
    const agentsArea = document.getElementById('agents-area');
    const navAdminStats = document.getElementById('nav-admin-stats');
    const navSettings = document.getElementById('nav-settings');
    const settingsArea = document.getElementById('settings-area');

    // Core Fetch Wrapper
    async function apiFetch(url, options = {}) {
        if (!options.headers) options.headers = {};
        if (authToken) {
            options.headers['Authorization'] = `Bearer ${authToken}`;
        }
        const res = await fetch(url, options);
        if (res.status === 401) {
            handleLogout();
            throw new Error('Unauthorized');
        }
        return res;
    }

    // Login Form Logic
    if (loginForm) {
        // Load saved ID/PW
        const savedId = localStorage.getItem('rag_saved_username');
        const savedPw = localStorage.getItem('rag_saved_password');
        const saveCheck = document.getElementById('login-save');
        if (savedId && savedPw) {
            document.getElementById('login-username').value = savedId;
            document.getElementById('login-password').value = savedPw;
            if (saveCheck) saveCheck.checked = true;
        }

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;

            const formData = new URLSearchParams();
            formData.append('username', username);
            formData.append('password', password);

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData
                });

                if (res.ok) {
                    const data = await res.json();

                    // Save or remove ID/PW based on checkbox
                    const saveCheck = document.getElementById('login-save');
                    if (saveCheck && saveCheck.checked) {
                        localStorage.setItem('rag_saved_username', username);
                        localStorage.setItem('rag_saved_password', password);
                    } else {
                        localStorage.removeItem('rag_saved_username');
                        localStorage.removeItem('rag_saved_password');
                    }

                    authToken = data.access_token;
                    currentUser = { username: data.username, role: data.role, id: data.id, organization_id: data.organization_id };
                    localStorage.setItem('rag_token', authToken);
                    localStorage.setItem('rag_user', JSON.stringify(currentUser));
                    loginError.style.display = 'none';
                    initApp();
                } else {
                    const err = await res.json();
                    loginError.textContent = err.error || "로그인 실패";
                    loginError.style.display = 'block';
                }
            } catch (err) {
                loginError.textContent = "서버 연결 오류";
                loginError.style.display = 'block';
            }
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', handleLogout);
    }

    function handleLogout() {
        if (window.pollingInterval) {
            clearInterval(window.pollingInterval);
            window.pollingInterval = null;
        }
        authToken = null;
        currentUser = null;
        localStorage.removeItem('rag_token');
        localStorage.removeItem('rag_user');
        loginApp.classList.remove('hidden');
        mainApp.classList.add('hidden');

        // Preserve password if saved
        if (!localStorage.getItem('rag_saved_password')) {
            document.getElementById('login-password').value = '';
        }
    }

    function initApp() {
        if (!authToken) {
            loginApp.classList.remove('hidden');
            mainApp.classList.add('hidden');
            return;
        }

        loginApp.classList.add('hidden');
        mainApp.classList.remove('hidden');
        currentUsernameDisplay.textContent = currentUser.username;

        // Set avatar initials and user profile
        const avatarEl = document.getElementById('user-avatar-initials');
        const avatarImgEl = document.getElementById('user-avatar-img');
        const roleEl = document.getElementById('current-user-role');

        if (currentUser.profile_image) {
            if (avatarImgEl) {
                avatarImgEl.src = currentUser.profile_image;
                avatarImgEl.style.display = 'block';
            }
            if (avatarEl) avatarEl.style.setProperty('display', 'none', 'important');
        } else {
            if (avatarImgEl) avatarImgEl.style.display = 'none';
            if (avatarEl) {
                avatarEl.style.setProperty('display', 'flex', 'important');
                const initials = currentUser.username
                    .split(/[\s_-]+/)
                    .map(w => w[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);
                avatarEl.textContent = initials || '?';
            }
        }

        if (roleEl) {
            roleEl.textContent = currentUser.role === 'admin' ? '관리자' : '사용자';
        }

        if (currentUser.role === 'admin') {
            navAdmin.classList.remove('hidden');
            if (navSettings) navSettings.classList.remove('hidden');
        } else {
            navAdmin.classList.add('hidden');
            if (navSettings) navSettings.classList.add('hidden');
        }
        if (navAdminStats) navAdminStats.classList.remove('hidden');

        // Initial load - load session list and start a new session
        loadCategories();
        loadFolderTree();
        window.loadSharedGroups();
        setTimeout(async () => {
            await loadChatHistory();
            await startNewSession();
            switchTab('chat');
        }, 0);
        apiFetch('/api/documents').then(r => r.json()).then(data => {
            // API returns {my_documents, public_documents}
            updateDocsList(data);
            const allDocs = [...(data.my_documents || []), ...(data.public_documents || [])];
            if (allDocs.length > 0) {
                const checking = allDocs.some(d => d.status === 'indexing' || d.status === 'pending');
                if (checking) startPollingStatus();
            }
        }).catch(e => console.error(e));
    }

    // Navigation
    const navManage = document.getElementById('nav-manage');
    const navChat = document.getElementById('nav-chat');

    const manageArea = document.getElementById('manage-area');
    const chatWrapper = document.getElementById('chat-wrapper');
    const adminStatsArea = document.getElementById('admin-stats-area');

    function switchTab(tab) {
        const histPanel = document.getElementById('chat-history-panel');
        // Reset all active classes
        [navManage, navChat, navAdmin, navAdminStats, navAgents, navSettings].forEach(n => n && n.classList.remove('active'));
        // Hide all areas
        [manageArea, chatWrapper, adminArea, adminStatsArea, agentsArea, settingsArea].forEach(a => a && a.classList.add('hidden'));

        if (tab === 'manage') {
            if (navManage) navManage.classList.add('active');
            if (manageArea) manageArea.classList.remove('hidden');
            if (histPanel) histPanel.classList.add('hidden');
        } else if (tab === 'chat') {
            if (navChat) navChat.classList.add('active');
            if (chatWrapper) chatWrapper.classList.remove('hidden');
            if (histPanel) histPanel.classList.remove('hidden');

            // Reload agents dropdown in chat when entering chat tab
            if (window.loadAgentsForChat) window.loadAgentsForChat();

        } else if (tab === 'admin') {
            if (navAdmin) navAdmin.classList.add('active');
            if (adminArea) adminArea.classList.remove('hidden');
            if (histPanel) histPanel.classList.add('hidden');
            // Load org tree whenever admin tab is opened
            if (currentUser && currentUser.role === 'admin') loadAdminOrgs();
        } else if (tab === 'admin-stats') {
            if (navAdminStats) navAdminStats.classList.add('active');
            if (adminStatsArea) adminStatsArea.classList.remove('hidden');
            if (histPanel) histPanel.classList.add('hidden');

            // Adapt UI based on user role
            const roleBadge = adminStatsArea.querySelector('.admin-role-badge');
            const btnSettings = document.getElementById('btn-stats-settings');
            const titleRow = adminStatsArea.querySelector('h1');
            const cardActiveUsers = document.getElementById('stats-card-active-users');
            const cardUserRankings = document.getElementById('stats-card-user-rankings');

            if (currentUser && currentUser.role === 'admin') {
                if (roleBadge) roleBadge.textContent = '관리자 전용';
                if (titleRow) titleRow.textContent = '사용량 통계';
                if (btnSettings) btnSettings.style.setProperty('display', 'flex', 'important');
                if (cardActiveUsers) cardActiveUsers.style.setProperty('display', 'flex', 'important');
                if (cardUserRankings) cardUserRankings.style.setProperty('display', 'block', 'important');
            } else {
                if (roleBadge) roleBadge.textContent = '개인 전용';
                if (titleRow) titleRow.textContent = '내 사용량 통계';
                if (btnSettings) btnSettings.style.setProperty('display', 'none', 'important');
                if (cardActiveUsers) cardActiveUsers.style.setProperty('display', 'none', 'important');
                if (cardUserRankings) cardUserRankings.style.setProperty('display', 'none', 'important');
            }

            if (typeof initAdminStats === 'function') initAdminStats();

        } else if (tab === 'settings') {
            if (navSettings) navSettings.classList.add('active');
            if (settingsArea) settingsArea.classList.remove('hidden');
            if (histPanel) histPanel.classList.add('hidden');
            if (currentUser && currentUser.role === 'admin') {
                if (window.tabSettingsBranding) window.tabSettingsBranding.click();
                else {
                    const tab = document.getElementById('tab-settings-branding');
                    if (tab) tab.click();
                }
            }
        } else if (tab === 'agents') {
            if (navAgents) navAgents.classList.add('active');
            if (agentsArea) agentsArea.classList.remove('hidden');
            if (histPanel) histPanel.classList.add('hidden');
            // Load agents whenever agents tab is opened
            if (window.loadAgentList) window.loadAgentList();
        }
    }

    navManage.addEventListener('click', () => { switchTab('manage'); closeMobileSidebar(); });
    navChat.addEventListener('click', () => { switchTab('chat'); closeMobileSidebar(); });
    if (navAdmin) navAdmin.addEventListener('click', () => { switchTab('admin'); closeMobileSidebar(); });
    if (navAdminStats) navAdminStats.addEventListener('click', () => { switchTab('admin-stats'); closeMobileSidebar(); });
    if (navAgents) navAgents.addEventListener('click', () => { switchTab('agents'); closeMobileSidebar(); });
    if (navSettings) navSettings.addEventListener('click', () => { switchTab('settings'); closeMobileSidebar(); });

    // ====== Sidebar Collapse / Mobile ======
    const mainSidebar = document.getElementById('main-sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const btnCollapse = document.getElementById('btn-sidebar-collapse');
    const btnSidebarOpen = document.getElementById('btn-sidebar-open');
    const isMobile = () => window.innerWidth <= 768;

    function closeMobileSidebar() {
        if (isMobile()) {
            mainSidebar.classList.remove('mobile-open');
            sidebarOverlay.classList.remove('active');
        }
    }

    if (btnCollapse) {
        btnCollapse.addEventListener('click', () => {
            if (isMobile()) {
                closeMobileSidebar();
            } else {
                mainSidebar.classList.toggle('collapsed');
                localStorage.setItem('sidebar_collapsed', mainSidebar.classList.contains('collapsed'));
            }
        });
    }

    if (btnSidebarOpen) {
        btnSidebarOpen.addEventListener('click', () => {
            mainSidebar.classList.add('mobile-open');
            sidebarOverlay.classList.add('active');
        });
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeMobileSidebar);
    }

    // Restore collapsed state on desktop
    if (!isMobile() && localStorage.getItem('sidebar_collapsed') === 'true') {
        mainSidebar.classList.add('collapsed');
    }

    // Admin Form Logic
    const formCreateOrg = document.getElementById('form-create-org');
    const formCreateUser = document.getElementById('form-create-user');

    // Manage Tabs
    const tabManageMy = document.getElementById('tab-manage-my');
    const tabManagePublic = document.getElementById('tab-manage-public');
    const tabManageSharedGroups = document.getElementById('tab-manage-shared-groups');
    const tabManageWebsite = document.getElementById('tab-manage-website');
    const panelManageDocs = document.getElementById('manage-docs-body');
    const panelManageGroups = document.getElementById('manage-groups-body');
    const panelManageWebsite = document.getElementById('manage-website-body');

    let currentManageTab = 'my';

    if (tabManageMy && tabManagePublic) {
        tabManageMy.addEventListener('click', async () => {
            tabManageMy.classList.add('active');
            tabManagePublic.classList.remove('active');
            if (tabManageSharedGroups) tabManageSharedGroups.classList.remove('active');
            if (tabManageWebsite) tabManageWebsite.classList.remove('active');

            if (panelManageDocs) panelManageDocs.classList.remove('hidden');
            if (panelManageGroups) panelManageGroups.classList.add('hidden');
            if (panelManageWebsite) panelManageWebsite.classList.add('hidden');

            currentManageTab = 'my';
            manageCurrentPage = 1;
            currentFolderId = null;

            // Show upload area and folder tree for my documents
            const dropzone = document.getElementById('upload-dropzone');
            if (dropzone) dropzone.style.display = 'flex';
            const folderTree = document.getElementById('folder-tree-panel');
            if (folderTree) folderTree.style.display = 'flex';
            const btnCreateFolder = document.getElementById('btn-create-folder');
            if (btnCreateFolder) btnCreateFolder.style.display = 'inline-flex';

            await loadFolderTree();
            await refreshDocsFromServer();
        });
        tabManagePublic.addEventListener('click', async () => {
            tabManagePublic.classList.add('active');
            tabManageMy.classList.remove('active');
            if (tabManageSharedGroups) tabManageSharedGroups.classList.remove('active');
            if (tabManageWebsite) tabManageWebsite.classList.remove('active');

            if (panelManageDocs) panelManageDocs.classList.remove('hidden');
            if (panelManageGroups) panelManageGroups.classList.add('hidden');
            if (panelManageWebsite) panelManageWebsite.classList.add('hidden');

            currentManageTab = 'public';
            manageCurrentPage = 1;
            currentFolderId = null;

            // Hide upload area, but KEEP folder tree for public documents
            const dropzone = document.getElementById('upload-dropzone');
            if (dropzone) dropzone.style.display = 'none';
            const folderTree = document.getElementById('folder-tree-panel');
            if (folderTree) folderTree.style.display = 'flex';
            const btnCreateFolder = document.getElementById('btn-create-folder');
            if (btnCreateFolder) btnCreateFolder.style.display = 'none';

            await loadFolderTree();
            await refreshDocsFromServer();
        });


        if (tabManageWebsite) {
            tabManageWebsite.addEventListener('click', async () => {
                tabManageWebsite.classList.add('active');
                tabManageMy.classList.remove('active');
                tabManagePublic.classList.remove('active');
                if (tabManageSharedGroups) tabManageSharedGroups.classList.remove('active');

                if (panelManageDocs) panelManageDocs.classList.add('hidden');
                if (panelManageGroups) panelManageGroups.classList.add('hidden');
                if (panelManageWebsite) panelManageWebsite.classList.remove('hidden');

                if (typeof loadWebsiteList === 'function') loadWebsiteList();
                if (window.websitePollingInterval) clearInterval(window.websitePollingInterval);
                window.websitePollingInterval = setInterval(() => {
                    if (panelManageWebsite && !panelManageWebsite.classList.contains('hidden')) {
                        if (typeof loadWebsiteList === 'function') loadWebsiteList();
                    }
                }, 5000);
            });
        }

        if (tabManageSharedGroups) {
            tabManageSharedGroups.addEventListener('click', async () => {
                tabManageSharedGroups.classList.add('active');
                tabManageMy.classList.remove('active');
                tabManagePublic.classList.remove('active');
                if (tabManageWebsite) tabManageWebsite.classList.remove('active');

                if (panelManageDocs) panelManageDocs.classList.add('hidden');
                if (panelManageWebsite) panelManageWebsite.classList.add('hidden');
                if (panelManageGroups) panelManageGroups.classList.remove('hidden');

                currentManageTab = 'shared-groups';
                if (typeof loadSharedGroups === 'function') {
                    await loadSharedGroups();
                    if (window.openSharedGroupEditor) window.openSharedGroupEditor(null);
                }
            });
        }
    }


    // Settings Tabs
    const tabSettingsBranding = document.getElementById('tab-settings-branding');
    const tabSettingsLlm = document.getElementById('tab-settings-llm');
    const panelSettingsBranding = document.getElementById('settings-panel-branding');
    const panelSettingsLlm = document.getElementById('settings-panel-llm');

    function switchSettingsTab(active) {
        const tabs = [tabSettingsBranding, tabSettingsLlm];
        const panels = [panelSettingsBranding, panelSettingsLlm];
        tabs.forEach((t, i) => {
            if (!t) return;
            if (t === active) { t.classList.add('active'); panels[i].classList.remove('hidden'); }
            else { t.classList.remove('active'); panels[i].classList.add('hidden'); }
        });
    }

    if (tabSettingsBranding) {
        tabSettingsBranding.addEventListener('click', () => {
            switchSettingsTab(tabSettingsBranding);
            loadBrandingSettings();
        });
    }
    if (tabSettingsLlm) {
        tabSettingsLlm.addEventListener('click', () => {
            switchSettingsTab(tabSettingsLlm);
            loadAdminSettings();
        });
    }

    // Admin Tabs
    const tabAdminOrgs = document.getElementById('tab-admin-orgs');
    const tabAdminUsers = document.getElementById('tab-admin-users');
    const tabAdminDocs = document.getElementById('tab-admin-docs');
    
    
    const panelAdminOrgs = document.getElementById('admin-panel-orgs');
    const panelAdminUsers = document.getElementById('admin-panel-users');
    const panelAdminDocs = document.getElementById('admin-panel-docs');
    
    

    function switchAdminTab(active) {
        const tabs = [tabAdminOrgs, tabAdminUsers, tabAdminDocs];
        const panels = [panelAdminOrgs, panelAdminUsers, panelAdminDocs];
        tabs.forEach((t, i) => {
            if (!t) return;
            if (t === active) { t.classList.add('active'); panels[i].classList.remove('hidden'); }
            else { t.classList.remove('active'); panels[i].classList.add('hidden'); }
        });
    }

    if (tabAdminOrgs) {
        tabAdminOrgs.addEventListener('click', () => {
            switchAdminTab(tabAdminOrgs);
            if (currentUser && currentUser.role === 'admin') loadAdminOrgs();
        });
        tabAdminUsers.addEventListener('click', () => {
            switchAdminTab(tabAdminUsers);
            if (currentUser && currentUser.role === 'admin') loadAdminUsers();
        });
        tabAdminDocs.addEventListener('click', () => {
            switchAdminTab(tabAdminDocs);
            if (currentUser && currentUser.role === 'admin') loadAdminDocs();
        });
    }

    if (formCreateOrg) {
        formCreateOrg.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('admin-org-name').value;
            const parent_id = document.getElementById('admin-org-parent').value;

            const payload = { name };
            if (parent_id) payload.parent_id = parseInt(parent_id);

            try {
                const res = await apiFetch('/api/admin/organizations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    window.showToast('조직이 생성되었습니다.', 'success');
                    document.getElementById('admin-org-name').value = '';
                    document.getElementById('admin-org-parent').value = '';
                    loadAdminOrgs();
                } else {
                    const err = await res.json();
                    window.showToast(`조직 생성 실패: ${err.error}`, 'error');
                }
            } catch (err) { console.error(err); }
        });
    }

    if (formCreateUser) {
        formCreateUser.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('admin-user-id').value;
            const fullName = document.getElementById('admin-user-fullname').value;
            const password = document.getElementById('admin-user-pw').value;
            const org = document.getElementById('admin-user-org').value;
            const isAdmin = document.getElementById('admin-user-is-admin').checked;
            try {
                const res = await apiFetch('/api/admin/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: username,
                        full_name: fullName || null,
                        password: password,
                        organization_id: parseInt(org || 1),
                        role: isAdmin ? 'admin' : 'user'
                    })
                });
                if (res.ok) {
                    window.showToast('새 구성원이 등록되었습니다.', 'success');
                    formCreateUser.reset();
                    loadAdminUsers();
                } else {
                    const err = await res.json();
                    window.showToast(`사용자 생성 실패: ${err.error}`, 'error');
                }
            } catch (err) { console.error(err); }
        });
    }

    // ─────────────────────────────────────────────────────
    // System LLM Settings Logic
    // ─────────────────────────────────────────────────────
    
    async function loadAdminSettings() {
        try {
            const res = await apiFetch('/api/admin/settings/llm');
            const data = await res.json();
            
            const container = document.getElementById('llm-settings-container');
            if(!container) return;
            container.innerHTML = '';
            
            const fields = [
                {id: 'index_llm_model', label: '문서 인덱싱 용 LLM'},
                {id: 'ocr_llm_model', label: '문서 OCR 용 LLM'},
                {id: 'crawl_llm_model', label: '웹크롤링 인덱싱 용 LLM'},
                {id: 'chat_vision_llm_model', label: '대화하기 이미지 해석용 LLM'},
                {id: 'chat_llm_model', label: '대화하기 텍스트 해석용 LLM'}
            ];
            
            fields.forEach(f => {
                let modelVal = data[f.id] || "gemini-flash-lite-latest";
                let isCustom = false;
                let endpointVal = '';
                let keyVal = '';
                if(typeof modelVal === 'object' && modelVal.is_custom) {
                    isCustom = true;
                    endpointVal = modelVal.endpoint || '';
                    keyVal = modelVal.api_key || '';
                    modelVal = modelVal.model || '';
                }
                
                const html = `
                    <div style="background: var(--bg-primary); padding: 16px; border: 1px solid var(--border-color); border-radius: 8px; margin: 0; display: flex; flex-direction: column; justify-content: flex-start;">
                        <h4 style="margin: 0 0 12px 0;">${f.label}</h4>
                        <div class="input-group">
                            <label>모델 분류</label>
                            <select id="sel-type-${f.id}" class="category-select" style="width: 100%; box-sizing: border-box;" onchange="document.getElementById('custom-wrap-${f.id}').style.display = this.value === 'custom' ? 'block' : 'none';">
                                <option value="gemini-flash-lite-latest" ${(!isCustom && modelVal==='gemini-flash-lite-latest') ? 'selected' : ''}>gemini-flash-lite-latest</option>
                                <option value="gemini-flash-latest" ${(!isCustom && modelVal==='gemini-flash-latest') ? 'selected' : ''}>gemini-flash-latest</option>
                                <option value="custom" ${isCustom ? 'selected' : ''}>사용자 정의 LLM</option>
                            </select>
                        </div>
                        <div id="custom-wrap-${f.id}" style="display: ${isCustom ? 'block' : 'none'}; padding-top: 10px; border-top: 1px solid var(--border-color); margin-top: 10px;">
                            <div class="input-group">
                                <label>Model Name (예: gpt-4o)</label>
                                <input type="text" id="custom-model-${f.id}" class="input-text" value="${isCustom ? modelVal : ''}">
                            </div>
                            <div class="input-group">
                                <label>API Endpoint (vLLM/OpenAI 규격 Url)</label>
                                <input type="text" id="custom-end-${f.id}" class="input-text" value="${endpointVal}" placeholder="http://localhost:8000/v1">
                            </div>
                            <div class="input-group">
                                <label>API Key</label>
                                <input type="password" id="custom-key-${f.id}" class="input-text" value="${keyVal}">
                            </div>
                        </div>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', html);
            });
            
            document.getElementById('btn-save-llm-settings').onclick = async () => {
                const payload = {};
                fields.forEach(f => {
                    const selType = document.getElementById(`sel-type-${f.id}`).value;
                    if(selType === 'custom') {
                        payload[f.id] = {
                            is_custom: true,
                            model: document.getElementById(`custom-model-${f.id}`).value,
                            endpoint: document.getElementById(`custom-end-${f.id}`).value,
                            api_key: document.getElementById(`custom-key-${f.id}`).value
                        };
                    } else {
                        // string baseline model
                        payload[f.id] = selType;
                    }
                });
                
                try {
                    const r = await apiFetch('/api/admin/settings/llm', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(payload)
                    });
                    if(r.ok) {
                        window.showToast("LLM 모델 설정이 저장되었습니다.", "success");
                    } else {
                        const err = await r.json();
                        window.showToast(`저장 실패: ${err.error}`, "error");
                    }
                } catch(e) { console.error(e); }
            };
            
        } catch(e) { console.error("Failed to load settings:", e); }
    }

    // ─────────────────────────────────────────────────────
    // Branding Logic
    // ─────────────────────────────────────────────────────

    /** Apply branding data to sidebar, login screen and page title */
    function applyBranding(b) {
        if (!b) return;
        const name = b.company_name || '추론형 RAG';
        const tagline = b.tagline || '';
        const logoUrl = b.logo_url || '';
        const logoType = b.logo_type || 'square';

        // Page title
        const pageTitle = document.getElementById('page-title');
        if (pageTitle) pageTitle.textContent = name;

        // Sidebar header
        const sidebarTitle = document.getElementById('sidebar-title');
        const sidebarLogo = document.getElementById('sidebar-logo');
        if (sidebarTitle) {
            sidebarTitle.textContent = name;
            if (logoType === 'rectangle') { sidebarTitle.style.display = 'none'; }
            else { sidebarTitle.style.display = ''; }
        }
        if (sidebarLogo) {
            if (logoUrl) {
                sidebarLogo.src = logoUrl;
                sidebarLogo.style.display = '';
                if (logoType === 'rectangle') {
                    sidebarLogo.style.maxWidth = '180px';
                } else {
                    sidebarLogo.style.maxWidth = '30px';
                }
            }
            else { sidebarLogo.style.display = 'none'; }
        }

        // Login screen
        const loginTitle = document.getElementById('login-title');
        const loginLogo = document.getElementById('login-logo');
        const loginTagline = document.getElementById('login-tagline');
        if (loginTitle) {
            loginTitle.textContent = name + ' 접속';
            if (logoType === 'rectangle') { loginTitle.style.display = 'none'; }
            else { loginTitle.style.display = ''; }
        }
        if (loginTagline) {
            loginTagline.textContent = tagline;
            if (logoType === 'rectangle') { loginTagline.style.display = 'none'; }
            else { loginTagline.style.display = ''; }
        }
        if (loginLogo) {
            if (logoUrl) {
                loginLogo.src = logoUrl;
                loginLogo.style.display = '';
                if (logoType === 'rectangle') {
                    loginLogo.style.maxWidth = '240px';
                    loginLogo.style.maxHeight = '80px';
                } else {
                    loginLogo.style.maxWidth = '180px';
                    loginLogo.style.maxHeight = '64px';
                }
            }
            else { loginLogo.style.display = 'none'; }
        }
    }

    /** Load branding from server and apply (called on startup, no auth needed) */
    async function loadBrandingOnStart() {
        try {
            const res = await fetch('/api/branding');
            if (res.ok) applyBranding(await res.json());
        } catch (e) { /* ignore */ }
    }

    /** Load current branding into the settings panel form */
    async function loadBrandingSettings() {
        try {
            const res = await fetch('/api/branding');
            if (!res.ok) return;
            const b = await res.json();

            const nameInput = document.getElementById('branding-company-name');
            const taglineInput = document.getElementById('branding-tagline');
            const logoTypeInput = document.getElementById('branding-logo-type');
            if (nameInput) nameInput.value = b.company_name || '';
            if (taglineInput) taglineInput.value = b.tagline || '';
            if (logoTypeInput) logoTypeInput.value = b.logo_type || 'square';

            // Update live preview
            updateBrandingPreview();

            // Show current logo
            const previewWrap = document.getElementById('branding-logo-preview-wrap');
            const previewImg = document.getElementById('branding-logo-preview');
            if (previewWrap && previewImg) {
                if (b.logo_url) {
                    previewImg.src = b.logo_url + '?t=' + Date.now();
                    previewWrap.style.display = '';
                    // Also update preview logo in text card
                    const prevLogo = document.getElementById('branding-preview-logo');
                    const prevLogoWrap = document.getElementById('branding-preview-logo-wrap');
                    if (prevLogo) prevLogo.src = b.logo_url + '?t=' + Date.now();
                    if (prevLogoWrap) prevLogoWrap.style.display = '';
                } else {
                    previewWrap.style.display = 'none';
                }
            }
        } catch (e) { console.error('loadBrandingSettings error', e); }
    }

    function updateBrandingPreview() {
        const nameInput = document.getElementById('branding-company-name');
        const taglineInput = document.getElementById('branding-tagline');
        const logoTypeInput = document.getElementById('branding-logo-type');
        const previewName = document.getElementById('branding-preview-name');
        const previewTagline = document.getElementById('branding-preview-tagline');
        const previewLogo = document.getElementById('branding-preview-logo');
        const type = logoTypeInput?.value || 'square';

        if (previewName) {
            previewName.textContent = nameInput?.value || '추론형 RAG';
            previewName.style.display = type === 'rectangle' ? 'none' : '';
        }
        if (previewTagline) {
            previewTagline.textContent = taglineInput?.value || '';
            previewTagline.style.display = type === 'rectangle' ? 'none' : '';
        }
        if (previewLogo) {
            if (type === 'rectangle') {
                previewLogo.style.width = '120px';
                previewLogo.style.height = 'auto';
                previewLogo.style.maxHeight = '32px';
            } else {
                previewLogo.style.width = '28px';
                previewLogo.style.height = '28px';
                previewLogo.style.maxHeight = '';
            }
        }
    }

    // Live preview updates
    const brandingNameInput = document.getElementById('branding-company-name');
    const brandingTaglineInput = document.getElementById('branding-tagline');
    const brandingLogoTypeInput = document.getElementById('branding-logo-type');
    if (brandingNameInput) brandingNameInput.addEventListener('input', updateBrandingPreview);
    if (brandingTaglineInput) brandingTaglineInput.addEventListener('input', updateBrandingPreview);
    if (brandingLogoTypeInput) brandingLogoTypeInput.addEventListener('change', updateBrandingPreview);

    // Save text branding
    const btnSaveBrandingText = document.getElementById('btn-save-branding-text');
    if (btnSaveBrandingText) {
        btnSaveBrandingText.addEventListener('click', async () => {
            const nameInput = document.getElementById('branding-company-name');
            const taglineInput = document.getElementById('branding-tagline');
            const logoTypeInput = document.getElementById('branding-logo-type');
            const company_name = nameInput?.value?.trim() || '추론형 RAG';
            const tagline = taglineInput?.value?.trim() || '';
            const logo_type = logoTypeInput?.value || 'square';
            try {
                const res = await apiFetch('/api/admin/branding', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ company_name, tagline, logo_type })
                });
                if (res.ok) {
                    const data = await res.json();
                    applyBranding(data.branding);
                    window.showToast('브랜딩 텍스트가 저장되었습니다.', 'success');
                } else {
                    const err = await res.json();
                    window.showToast('저장 실패: ' + (err.error || '알 수 없는 오류'), 'error');
                }
            } catch (e) { console.error(e); window.showToast('저장 중 오류 발생', 'error'); }
        });
    }

    // Logo Drop Zone
    let pendingLogoFile = null;
    const logoDropZone = document.getElementById('branding-logo-drop-zone');
    const logoInput = document.getElementById('branding-logo-input');
    const btnUploadLogo = document.getElementById('btn-upload-logo');
    const logoNewPreview = document.getElementById('branding-logo-new-preview');
    const logoNewImg = document.getElementById('branding-logo-new-img');
    const logoFilename = document.getElementById('branding-logo-filename');

    function showNewLogoPreview(file) {
        if (!file || !file.type.startsWith('image/')) return;
        pendingLogoFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            if (logoNewImg) logoNewImg.src = e.target.result;
            if (logoFilename) logoFilename.textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
            if (logoNewPreview) logoNewPreview.style.display = '';
            if (btnUploadLogo) btnUploadLogo.style.display = '';
            // Also update the preview card logo
            const prevLogo = document.getElementById('branding-preview-logo');
            const prevLogoWrap = document.getElementById('branding-preview-logo-wrap');
            if (prevLogo) prevLogo.src = e.target.result;
            if (prevLogoWrap) prevLogoWrap.style.display = '';
        };
        reader.readAsDataURL(file);
    }

    if (logoDropZone) {
        logoDropZone.addEventListener('click', () => logoInput && logoInput.click());
        logoDropZone.addEventListener('dragover', (e) => { e.preventDefault(); logoDropZone.style.borderColor = 'var(--primary)'; });
        logoDropZone.addEventListener('dragleave', () => { logoDropZone.style.borderColor = ''; });
        logoDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            logoDropZone.style.borderColor = '';
            const file = e.dataTransfer.files[0];
            if (file) showNewLogoPreview(file);
        });
    }
    if (logoInput) {
        logoInput.addEventListener('change', () => {
            if (logoInput.files[0]) showNewLogoPreview(logoInput.files[0]);
        });
    }

    if (btnUploadLogo) {
        btnUploadLogo.addEventListener('click', async () => {
            if (!pendingLogoFile) return;
            const formData = new FormData();
            formData.append('file', pendingLogoFile);
            try {
                const res = await apiFetch('/api/admin/branding/logo', { method: 'POST', body: formData });
                if (res.ok) {
                    const data = await res.json();
                    applyBranding({ company_name: document.getElementById('branding-company-name')?.value || '추론형 RAG', tagline: document.getElementById('branding-tagline')?.value || '', logo_type: document.getElementById('branding-logo-type')?.value || 'square', logo_url: data.logo_url });
                    window.showToast('로고가 업로드되었습니다.', 'success');
                    pendingLogoFile = null;
                    if (logoNewPreview) logoNewPreview.style.display = 'none';
                    if (btnUploadLogo) btnUploadLogo.style.display = 'none';
                    // Show in current logo area
                    const previewWrap = document.getElementById('branding-logo-preview-wrap');
                    const previewImg = document.getElementById('branding-logo-preview');
                    if (previewWrap) previewWrap.style.display = '';
                    if (previewImg) previewImg.src = data.logo_url + '?t=' + Date.now();
                } else {
                    const err = await res.json();
                    window.showToast('업로드 실패: ' + (err.error || '알 수 없는 오류'), 'error');
                }
            } catch (e) { console.error(e); window.showToast('업로드 중 오류 발생', 'error'); }
        });
    }

    // Delete logo
    const btnDeleteLogo = document.getElementById('btn-delete-logo');
    if (btnDeleteLogo) {
        btnDeleteLogo.addEventListener('click', async () => {
            const confirmed = await window.showConfirm('로고를 삭제하시겠습니까?', '로고 삭제', '삭제', '취소');
            if (!confirmed) return;
            try {
                const res = await apiFetch('/api/admin/branding/logo', { method: 'DELETE' });
                if (res.ok) {
                    const data = await res.json();
                    applyBranding(data.branding);
                    window.showToast('로고가 삭제되었습니다.', 'success');
                    const previewWrap = document.getElementById('branding-logo-preview-wrap');
                    if (previewWrap) previewWrap.style.display = 'none';
                    const prevLogoWrap = document.getElementById('branding-preview-logo-wrap');
                    if (prevLogoWrap) prevLogoWrap.style.display = 'none';
                } else {
                    window.showToast('삭제 실패', 'error');
                }
            } catch (e) { console.error(e); }
        });
    }

    // Load branding immediately on page load (before auth)
    loadBrandingOnStart();

    // Global document state
    window.myDocuments = [];
    window.publicDocuments = [];
    window.allDocuments = []; // Flat list of all docs visible to user
    let activeDocs = [];
    window.selectedDocs = new Set();

    // Pagination and Filtering for Manage Area
    let manageCurrentPage = 1;
    let manageItemsPerPage = 10;
    let manageCurrentCategory = 'All';

    // Chat History for Multi-turn Conversation
    let chatHistory = [];
    let currentSessionId = null;

    // Chat Session List State (declared early to avoid TDZ in loadChatHistory)
    let allSessions = [];
    const SESSION_PREVIEW_COUNT = 20;
    let showingAllSessions = false;

    // UI Elements
    const uploadInput = document.getElementById('pdf-upload');
    const docsList = document.getElementById('docs-list');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const chatMessages = document.getElementById('chat-messages');

    // Chat Attachment Elements
    const chatFileUpload = document.getElementById('chat-file-upload');
    const btnAttachFile = document.getElementById('btn-attach-file');
    const chatAttachmentPreview = document.getElementById('chat-attachment-preview');
    const chatAttachmentName = document.getElementById('chat-attachment-name');
    const btnRemoveAttachment = document.getElementById('btn-remove-attachment');
    let attachedFile = null;

    // Category Elements
    const uploadCategory = document.getElementById('upload-category');
    const uploadVisibility = document.getElementById('upload-visibility');
    const btnNewCategory = document.getElementById('btn-new-category');
    const chatCategoryBtn = document.getElementById('chat-category-btn');
    const chatCategoryLabel = document.getElementById('chat-category-label');
    const chatCategoryDropdown = document.getElementById('chat-category-dropdown');
    let selectedChatCategories = ['All'];
    const manageCategorySelect = document.getElementById('manage-category-filter');
    const itemsPerPageSelect = document.getElementById('items-per-page');
    const btnPrevPage = document.getElementById('btn-prev-page');
    const btnNextPage = document.getElementById('btn-next-page');
    const pageInfo = document.getElementById('page-info');
    const pdfPane = document.getElementById('pdf-pane');
    const pdfViewer = document.getElementById('pdf-viewer');
    const pdfTitle = document.getElementById('pdf-title');
    const pdfOverlay = document.getElementById('pdf-overlay');

    // Chat Session UI Elements (declared early to avoid TDZ)
    const chatHistoryPanel = document.getElementById('chat-history-panel');
    const chatSessionList = document.getElementById('chat-session-list');
    const btnNewChat = document.getElementById('btn-new-chat');
    const btnShowAllSessions = document.getElementById('btn-show-all-sessions');

    // Deprecated Modal elements removed

    // Resize textarea automatically
    chatInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.value.trim() === '') {
            sendBtn.disabled = true;
        } else {
            sendBtn.disabled = false;
        }
    });

    chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    function updateChatPlaceholder() {
        if (chatInput) {
            if (window.innerWidth <= 768) {
                chatInput.placeholder = "자유롭게 질문해 보세요...";
            } else {
                chatInput.placeholder = "업로드한 문서에 대하여 자유롭게 질문해 보세요...";
            }
        }
        document.querySelectorAll('.revise-input').forEach(input => {
            if (window.innerWidth <= 768) {
                input.placeholder = "어떻게 보완할까요?";
            } else {
                input.placeholder = "답변을 어떻게 보완할까요? (예: 더 짧게 요약해줘)";
            }
        });
    }
    window.addEventListener('resize', updateChatPlaceholder);
    updateChatPlaceholder();

    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            sendMessage();
        });
    }

    // Category Logic
    async function loadCategories() {
        try {
            const res = await apiFetch('/api/categories');
            if (res.ok) {
                const data = await res.json();
                populateCategorySelects(data.categories);
            }
        } catch (err) {
            console.error(err);
        }
    }

    // ====== Folder Tree State ======
    let allFolders = [];           // flat list from API
    let currentFolderId = null;    // null = show all; number = filter by folder
    let contextTargetFolder = null; // folder for context menu actions
    let folderModalMode = 'create'; // 'create' | 'rename'

    // ====== Folder Helpers ======
    function getFolderFullPath(folderId) {
        if (!allFolders) return '';
        const f = allFolders.find(x => x.id === folderId);
        if (!f) return '';
        if (!f.parent_id) return f.name;
        const parentPath = getFolderFullPath(f.parent_id);
        return parentPath ? parentPath + ' > ' + f.name : f.name;
    }

    function getDescendantFolderNames(folderName) {
        if (typeof allFolders === 'undefined' || !allFolders) return [folderName];
        const rootFolder = allFolders.find(f => f.name === folderName);
        if (!rootFolder) return [folderName];
        let names = [folderName];
        const findChildren = (parentId) => {
            const children = allFolders.filter(f => f.parent_id === parentId);
            children.forEach(c => {
                if (!names.includes(c.name)) names.push(c.name);
                findChildren(c.id);
            });
        };
        findChildren(rootFolder.id);
        return names;
    }

    // ====== Folder Tree Load + Render ======
    async function loadFolderTree() {
        try {
            const res = await apiFetch('/api/folders');
            if (!res.ok) return;
            const data = await res.json();
            allFolders = data.folders || [];
            renderFolderTree();
            // Sync upload-category select for PDF upload
            syncUploadCategory();
        } catch (err) {
            console.error('loadFolderTree error', err);
        }
    }

    function syncUploadCategory() {
        if (!uploadCategory) return;
        uploadCategory.innerHTML = '';
        allFolders.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.name;
            opt.textContent = getFolderFullPath(f.id); // Show full path, but keep value as name
            uploadCategory.appendChild(opt);
        });
        // Set to current folder name if any
        if (currentFolderId !== null) {
            const cur = allFolders.find(f => f.id === currentFolderId);
            if (cur) uploadCategory.value = cur.name;
        }
        // Also refresh chat category filter
        if (typeof chatCategoryDropdown !== 'undefined' && chatCategoryDropdown) {
            let html = `
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; padding:4px 8px; border-radius:4px; transition:background 0.2s; font-size:0.85rem;" class="chat-category-option">
                    <input type="checkbox" value="All" ${selectedChatCategories.includes('All') ? 'checked' : ''} style="margin:0;"> 모든 카테고리
                </label>
                <div style="height:1px; background:var(--border-color); margin:2px 0;"></div>
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; padding:4px 8px; border-radius:4px; transition:background 0.2s; font-size:0.85rem;" class="chat-category-option">
                    <input type="checkbox" value="Public" ${selectedChatCategories.includes('Public') ? 'checked' : ''} style="margin:0;"> 🏢 공용 문서
                </label>
            `;
            const sortedFolders = [...allFolders].sort((a, b) => getFolderFullPath(a.id).localeCompare(getFolderFullPath(b.id)));
            sortedFolders.forEach(f => {
                html += `
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; padding:4px 8px; border-radius:4px; transition:background 0.2s; font-size:0.85rem;" class="chat-category-option">
                    <input type="checkbox" value="${f.name}" ${selectedChatCategories.includes(f.name) ? 'checked' : ''} style="margin:0;"> ${getFolderFullPath(f.id)}
                </label>
                `;
            });
            chatCategoryDropdown.innerHTML = html;
        }
    }

    function documentHasActualCategory(doc) {
        return doc.category && doc.category.trim() !== '';
    }

    function getFolderName(id) {
        if (id === null) return '전체 문서';
        const f = allFolders.find(x => x.id === id);
        return f ? f.name : '알 수 없음';
    }

    function getTabFolders(tabName) {
        if (typeof allFolders === 'undefined' || !currentUser) return [];

        const myCategories = new Set((window.myDocuments || []).filter(d => documentHasActualCategory(d)).map(d => d.category));
        const pubCategories = new Set((window.publicDocuments || []).filter(d => documentHasActualCategory(d)).map(d => d.category));

        function isUsedInSet(folder, catSet) {
            if (catSet.has(folder.name)) return true;
            return getDescendantFolderNames(folder.name).some(dn => catSet.has(dn));
        }

        return allFolders.filter(f => {
            const isMine = String(f.owner_id) === String(currentUser.id);
            const usedInMy = isUsedInSet(f, myCategories);
            const usedInPub = isUsedInSet(f, pubCategories);

            if (tabName === 'my') {
                if (usedInMy) return true;
                if (usedInPub) return false;
                return isMine;
            } else if (tabName === 'public') {
                if (usedInPub) return true;
                if (usedInMy) return false;
                return !isMine;
            }
            return false;
        });
    }

    function renderFolderTree() {
        const treeList = document.getElementById('folder-tree-list');
        const breadcrumb = document.getElementById('folder-breadcrumb');
        const folderNameEl = document.getElementById('current-folder-name');
        if (!treeList) return;

        // Update breadcrumb
        if (breadcrumb) {
            breadcrumb.innerHTML = '';
            // Always show Home
            const homeSpan = document.createElement('span');
            homeSpan.className = 'breadcrumb-item';
            homeSpan.textContent = '🏠 홈';
            homeSpan.addEventListener('click', () => navigateFolder(null));
            breadcrumb.appendChild(homeSpan);

            // Build ancestry chain if in a subfolder
            if (currentFolderId !== null) {
                const ancestors = getAncestors(currentFolderId);
                ancestors.forEach(f => {
                    const sep = document.createElement('span');
                    sep.className = 'breadcrumb-sep';
                    sep.textContent = ' › ';
                    breadcrumb.appendChild(sep);
                    const sp = document.createElement('span');
                    sp.className = 'breadcrumb-item';
                    sp.textContent = f.name;
                    sp.addEventListener('click', () => navigateFolder(f.id));
                    breadcrumb.appendChild(sp);
                });
            }
        }

        if (folderNameEl) {
            folderNameEl.textContent = currentFolderId === null ? '전체 문서' : getFolderName(currentFolderId);
        }

        // Determine which folders to show (children of current, or root if null)
        const parentId = currentFolderId; // show children of this

        let filteredFolders = typeof getTabFolders === 'function' ? getTabFolders(currentManageTab) : allFolders;

        // Ensure uncategorized virtual folder is shown if needed
        const docsInTab = currentManageTab === 'my' ? window.myDocuments : window.publicDocuments;
        const hasUncategorized = (docsInTab || []).some(d => !documentHasActualCategory(d));
        if (hasUncategorized) {
            filteredFolders.push({
                id: 'uncategorized',
                name: '미분류',
                parent_id: null,
                owner_id: currentUser.id
            });
        }

        const toShow = filteredFolders.filter(f => {
            if (parentId !== null) return f.parent_id === parentId;
            // Root display: if parent_id is null OR parent folder is not in our filtered list
            if (f.parent_id === null) return true;
            return !filteredFolders.some(p => p.id === f.parent_id);
        });
        treeList.innerHTML = '';

        if (parentId !== null) {
            // Add ".." go-up entry
            const upNode = document.createElement('div');
            upNode.className = 'folder-node';
            upNode.innerHTML = `
                <span class="folder-icon">📁</span>
                <span class="folder-name" style="color:var(--text-secondary);">..</span>`;
            const parentFolder = allFolders.find(f => f.id === parentId);
            upNode.addEventListener('click', () => navigateFolder(parentFolder?.parent_id ?? null));
            treeList.appendChild(upNode);
        }

        if (toShow.length === 0 && parentId === null) {
            treeList.innerHTML = '<div style="padding:10px 12px;color:var(--text-secondary);font-size:0.82rem;">카테고리 없음</div>';
        }

        toShow.forEach(folder => {
            const hasChildren = filteredFolders.some(f => f.parent_id === folder.id);
            // Count docs in this folder
            const docCount = (window.allDocuments || []).filter(d => d.category === folder.name).length;
            const isActive = currentFolderId === folder.id;

            let visibilityBadge = '';
            if (currentManageTab === 'public' && folder.owner_name) {
                visibilityBadge = `<span style="font-size: 0.65rem; color: #64748b; margin-left: 6px;">(${escapeHtml(folder.owner_name)})</span>`;
            } else {
                if (folder.visibility === 'organization') visibilityBadge = '<span style="font-size: 0.65rem; background: #e2e8f0; color: #475569; padding: 2px 4px; border-radius: 4px; margin-left: 6px;">공용</span>';
                if (folder.visibility === 'public') visibilityBadge = '<span style="font-size: 0.65rem; background: #e0f2fe; color: #0284c7; padding: 2px 4px; border-radius: 4px; margin-left: 6px;">전체</span>';
            }

            const node = document.createElement('div');
            node.className = 'folder-node' + (isActive ? ' active' : '');
            node.dataset.folderId = folder.id;
            node.innerHTML = `
                <span class="folder-icon">${hasChildren ? '📂' : '📁'}</span>
                <span class="folder-name">${escapeHtml(folder.name)}${visibilityBadge}</span>
                ${docCount > 0 ? `<span class="folder-count">${docCount}</span>` : ''}
                ${(currentManageTab === 'my' && folder.id !== 'uncategorized' && (String(folder.owner_id) === String(currentUser.id) || currentUser.role === 'admin')) ? `<button class="folder-menu-btn" title="옵션">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                </button>` : ''}`;

            // Folder click: navigate into folder
            node.addEventListener('click', (e) => {
                if (e.target.closest('.folder-menu-btn')) return;
                navigateFolder(folder.id);
            });

            // Menu button: context menu
            const menuBtn = node.querySelector('.folder-menu-btn');
            if (menuBtn) {
                menuBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showFolderContextMenu(e, folder);
                });
            }

            treeList.appendChild(node);
        });
    }

    function getAncestors(folderId) {
        const result = [];
        let cur = allFolders.find(f => f.id === folderId);
        while (cur) {
            result.unshift(cur);
            cur = cur.parent_id ? allFolders.find(f => f.id === cur.parent_id) : null;
        }
        return result;
    }

    function navigateFolder(folderId) {
        currentFolderId = folderId;
        // Update upload category selection
        if (uploadCategory && folderId !== null) {
            const folder = allFolders.find(f => f.id === folderId);
            if (folder) uploadCategory.value = folder.name;
        }
        renderFolderTree();
        manageCurrentPage = 1;
        if (window.allDocuments) updateDocsList(window.allDocuments);
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ====== Folder Context Menu ======
    const folderCtxMenu = document.getElementById('folder-context-menu');
    const ctxRenameBtn = document.getElementById('ctx-rename-folder');
    const ctxDeleteBtn = document.getElementById('ctx-delete-folder');

    function showFolderContextMenu(e, folder) {
        contextTargetFolder = folder;
        if (!folderCtxMenu) return;
        folderCtxMenu.classList.remove('hidden');
        const x = Math.min(e.clientX, window.innerWidth - 160);
        const y = Math.min(e.clientY, window.innerHeight - 100);
        folderCtxMenu.style.left = x + 'px';
        folderCtxMenu.style.top = y + 'px';
    }

    document.addEventListener('click', (e) => {
        if (folderCtxMenu && !folderCtxMenu.contains(e.target)) {
            folderCtxMenu.classList.add('hidden');
        }
    });

    if (ctxRenameBtn) {
        ctxRenameBtn.addEventListener('click', () => {
            folderCtxMenu.classList.add('hidden');
            if (!contextTargetFolder) return;
            openFolderModal('rename', contextTargetFolder.name, contextTargetFolder.visibility || 'private');
        });
    }

    if (ctxDeleteBtn) {
        ctxDeleteBtn.addEventListener('click', async () => {
            folderCtxMenu.classList.add('hidden');
            if (!contextTargetFolder) return;
            const folder = contextTargetFolder;
            const ok = await window.showConfirm(`"${folder.name}" 폴더를 삭제하시겠습니까?\n내부 문서는 상위 폴더로 이동됩니다.`, '폴더 삭제');
            if (!ok) return;
            try {
                const res = await apiFetch(`/api/folders/${folder.id}`, { method: 'DELETE' });
                if (res.ok) {
                    if (currentFolderId === folder.id) currentFolderId = folder.parent_id ?? null;
                    window.showToast(`폴더 "${folder.name}" 삭제됨`, 'success');
                    await loadFolderTree();
                    const docsRes = await apiFetch('/api/documents');
                    if (docsRes.ok) {
                        const data = await docsRes.json();
                        updateDocsList(data);
                    }
                } else {
                    const err = await res.json();
                    window.showToast(err.error || '삭제 실패', 'error');
                }
            } catch (err) { console.error(err); }
        });
    }

    // ====== Folder Modal (Create / Rename) ======
    const modalFolderEl = document.getElementById('modal-folder-name');
    const inputFolderName = document.getElementById('input-folder-name');
    const btnCancelFolder = document.getElementById('btn-cancel-folder');
    const btnConfirmFolder = document.getElementById('btn-confirm-folder');
    const modalFolderTitle = document.getElementById('modal-folder-title');
    const selectFolderVisibility = document.getElementById('select-folder-visibility');
    function openFolderModal(mode, defaultName = '', defaultVisibility = 'private') {
        folderModalMode = mode;
        if (modalFolderTitle) modalFolderTitle.textContent = mode === 'create' ? '새 카테고리(웹사이트)' : '카테고리/웹사이트 설정 변경';
        if (inputFolderName) inputFolderName.value = defaultName;
        if (selectFolderVisibility) selectFolderVisibility.value = defaultVisibility;
        if (modalFolderEl) {
            modalFolderEl.classList.add('active');
        } else {
            console.error("modalFolderEl is null!");
        }
        setTimeout(() => inputFolderName && inputFolderName.focus(), 80);
    }

    if (btnCancelFolder) {
        btnCancelFolder.addEventListener('click', () => {
            modalFolderEl.classList.remove('active');
        });
    }

    if (btnConfirmFolder) {
        btnConfirmFolder.addEventListener('click', async () => {
            const name = (inputFolderName?.value || '').trim();
            const visibility = selectFolderVisibility?.value || 'private';
            if (!name) { window.showToast('이름을 입력해주세요.', 'error'); return; }
            modalFolderEl.classList.remove('active');

            if (folderModalMode === 'create') {
                try {
                    const res = await apiFetch('/api/folders', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, parent_id: currentFolderId, visibility })
                    });
                    if (res.ok) {
                        window.showToast(`"${name}" 생성됨`, 'success');
                        await loadFolderTree();
                    } else {
                        const err = await res.json();
                        window.showToast(err.error || '생성 실패', 'error');
                    }
                } catch (e) { console.error(e); }
            } else {
                // rename & change visibility
                if (!contextTargetFolder) return;
                try {
                    const res = await apiFetch(`/api/folders/${contextTargetFolder.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, visibility })
                    });
                    if (res.ok) {
                        window.showToast(`"${name}" 폴더 설정이 변경됨`, 'success');
                        await loadFolderTree();
                        const docsRes = await apiFetch('/api/documents');
                        if (docsRes.ok) {
                            const data = await docsRes.json();
                            updateDocsList(data);
                        }
                    } else {
                        const err = await res.json();
                        window.showToast(err.error || '변경 실패', 'error');
                    }
                } catch (e) { console.error(e); }
            }
        });
    }

    if (inputFolderName) {
        inputFolderName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') btnConfirmFolder && btnConfirmFolder.click();
            if (e.key === 'Escape') modalFolderEl && modalFolderEl.classList.remove('active');
        });
    }

    // "새 폴더" toolbar button
    const btnCreateFolder = document.getElementById('btn-create-folder');
    if (btnCreateFolder) {
        btnCreateFolder.addEventListener('click', () => {
            openFolderModal('create');
        });
    }

    // ====== Drag & Drop Upload ======
    const dropzone = document.getElementById('upload-dropzone');
    const btnDropzoneClick = document.getElementById('btn-dropzone-click');

    if (btnDropzoneClick) {
        btnDropzoneClick.addEventListener('click', (e) => {
            e.preventDefault();
            uploadInput.click();
        });
    }

    if (dropzone) {
        dropzone.addEventListener('dragenter', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
        dropzone.addEventListener('dragleave', (e) => { if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('drag-over'); });
        dropzone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropzone.classList.remove('drag-over');
            const allowedExts = ['.pdf', '.txt', '.md', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.hwp', '.hwpx'];
            const files = Array.from(e.dataTransfer.files).filter(f => {
                const ext = f.name.toLowerCase().substring(f.name.lastIndexOf('.'));
                return allowedExts.includes(ext);
            });
            if (files.length === 0) { window.showToast('지원하지 않는 파일 형식입니다. (PDF, Word, Excel, PPT, HWP, TXT, 이미지 지원)', 'error'); return; }
            for (const file of files) {
                await uploadSingleFile(file);
            }
        });
    }

    // Existing file input handler - now supports multiple files
    if (uploadInput) {
        uploadInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            for (const file of files) {
                await uploadSingleFile(file);
            }
            uploadInput.value = '';
        });
    }

    async function uploadSingleFile(file) {
        const allowedExts = ['.pdf', '.txt', '.md', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.hwp', '.hwpx'];
        const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
        if (!allowedExts.includes(ext)) {
            window.showToast(`${file.name}: 지원하지 않는 파일 형식입니다. (지원 형식: PDF, Office, HWP, TXT, 이미지)`, 'error');
            return;
        }
        const formData = new FormData();
        formData.append('file', file);
        // Use current folder's category name; fallback to 'General'
        let catName = '';
        if (currentFolderId === 'uncategorized') {
            catName = '';
        } else if (currentFolderId !== null) {
            const folder = (typeof allFolders !== 'undefined' ? allFolders : []).find(f => f.id === currentFolderId);
            if (folder) catName = folder.name;
        } else if (uploadCategory && uploadCategory.style && uploadCategory.style.display !== 'none' && uploadCategory.value) {
            catName = uploadCategory.value;
        }
        formData.append('category', catName);
        formData.append('visibility', uploadVisibility ? uploadVisibility.value : 'private');
        window.showToast(`"${file.name}" 업로드 중...`, 'info');
        try {
            const res = await apiFetch('/api/upload', { method: 'POST', body: formData });
            if (res.ok) {
                window.showToast(`"${file.name}" 업로드 완료`, 'success');
                const docsRes = await apiFetch('/api/documents');
                if (docsRes.ok) {
                    const data = await docsRes.json();
                    updateDocsList(data);
                    renderFolderTree();
                }
                startPollingStatus();
            } else {
                const err = await res.json();
                if (res.status === 409 || err.duplicate) {
                    if (window.showAlertDialog) {
                        window.showAlertDialog("업로드 차단", err.error || "동일한 폴더에 동명의 파일이 이미 존재합니다.");
                    } else {
                        window.showToast(`${file.name}: ${err.error || '중복 업로드'}`, 'error');
                    }
                } else {
                    window.showToast(`${file.name}: ${err.error || '업로드 실패'}`, 'error');
                }
            }
        } catch (err) {
            window.showToast(`${file.name}: 업로드 오류`, 'error');
            console.error(err);
        }
    }


    function updateChatCategoryLabel() {
        if (!chatCategoryLabel) return;
        if (selectedChatCategories.includes('All')) {
            chatCategoryLabel.textContent = '모든 카테고리';
        } else if (selectedChatCategories.length === 1) {
            chatCategoryLabel.textContent = selectedChatCategories[0] === 'Public' ? '🏢 공용 문서' : selectedChatCategories[0];
        } else {
            const first = selectedChatCategories[0] === 'Public' ? '공용 문서' : selectedChatCategories[0];
            chatCategoryLabel.textContent = `${first} 외 ${selectedChatCategories.length - 1}건`;
        }
    }

    if (chatCategoryBtn && chatCategoryDropdown) {
        chatCategoryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            chatCategoryDropdown.classList.toggle('hidden');
        });
        document.addEventListener('click', (e) => {
            if (!chatCategoryBtn.contains(e.target) && !chatCategoryDropdown.contains(e.target)) {
                chatCategoryDropdown.classList.add('hidden');
            }
        });
        chatCategoryDropdown.addEventListener('change', (e) => {
            if (e.target.matches('input[type="checkbox"]')) {
                const val = e.target.value;
                if (val === 'All') {
                    if (e.target.checked) {
                        selectedChatCategories = ['All'];
                        chatCategoryDropdown.querySelectorAll('input').forEach(cb => {
                            if (cb.value !== 'All') cb.checked = false;
                        });
                    } else {
                        e.target.checked = true;
                    }
                } else {
                    if (e.target.checked) {
                        selectedChatCategories = selectedChatCategories.filter(c => c !== 'All');
                        const allCb = chatCategoryDropdown.querySelector('input[value="All"]');
                        if (allCb) allCb.checked = false;
                        if (!selectedChatCategories.includes(val)) selectedChatCategories.push(val);
                    } else {
                        selectedChatCategories = selectedChatCategories.filter(c => c !== val);
                        if (selectedChatCategories.length === 0) {
                            selectedChatCategories = ['All'];
                            const allCb = chatCategoryDropdown.querySelector('input[value="All"]');
                            if (allCb) allCb.checked = true;
                        }
                    }
                }
                updateChatCategoryLabel();
                if (window.allDocuments) updateDocsList(window.allDocuments);
            }
        });
    }

    function populateCategorySelects(categories) {
        uploadCategory.innerHTML = '';
        if (manageCategorySelect) manageCategorySelect.innerHTML = '<option value="All">모든 카테고리</option>';

        if (chatCategoryDropdown) {
            let html = `
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; padding:4px 8px; border-radius:4px; transition:background 0.2s; font-size:0.85rem;" class="chat-category-option">
                    <input type="checkbox" value="All" ${selectedChatCategories.includes('All') ? 'checked' : ''} style="margin:0;"> 모든 카테고리
                </label>
                <div style="height:1px; background:var(--border-color); margin:2px 0;"></div>
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; padding:4px 8px; border-radius:4px; transition:background 0.2s; font-size:0.85rem;" class="chat-category-option">
                    <input type="checkbox" value="Public" ${selectedChatCategories.includes('Public') ? 'checked' : ''} style="margin:0;"> 🏢 공용 문서
                </label>
            `;
            categories.forEach(cat => {
                html += `
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; padding:4px 8px; border-radius:4px; transition:background 0.2s; font-size:0.85rem;" class="chat-category-option">
                    <input type="checkbox" value="${cat}" ${selectedChatCategories.includes(cat) ? 'checked' : ''} style="margin:0;"> ${cat}
                </label>
                `;
            });
            chatCategoryDropdown.innerHTML = html;
        }

        categories.forEach(cat => {
            const opt1 = document.createElement('option');
            opt1.value = cat;
            opt1.textContent = cat;
            uploadCategory.appendChild(opt1);

            if (manageCategorySelect) {
                const opt3 = document.createElement('option');
                opt3.value = cat;
                opt3.textContent = cat;
                manageCategorySelect.appendChild(opt3);
            }
        });
    }

    // ====== New Category Modal ======
    const modalAddCat = document.getElementById('modal-add-category');
    const inputNewCat = document.getElementById('input-new-category');
    const btnCancelCat = document.getElementById('btn-cancel-add-category');
    const btnConfirmCat = document.getElementById('btn-confirm-add-category');

    function addCategoryToSelects(catName) {
        const opt1 = document.createElement('option');
        opt1.value = catName; opt1.textContent = catName;
        uploadCategory.appendChild(opt1);
        uploadCategory.value = catName;

        if (chatCategoryDropdown) {
            const lbl = document.createElement('label');
            lbl.className = 'chat-category-option';
            lbl.style.cssText = 'display:flex; align-items:center; gap:6px; cursor:pointer; padding:4px 8px; border-radius:4px; transition:background 0.2s; font-size:0.85rem;';
            lbl.innerHTML = `<input type="checkbox" value="${catName}" style="margin:0;"> ${catName}`;
            chatCategoryDropdown.appendChild(lbl);
        }

        if (manageCategorySelect) {
            const opt3 = document.createElement('option');
            opt3.value = catName; opt3.textContent = catName;
            manageCategorySelect.appendChild(opt3);
        }
    }

    if (btnNewCategory) {
        btnNewCategory.addEventListener('click', () => {
            if (inputNewCat) inputNewCat.value = '';
            if (modalAddCat) modalAddCat.classList.add('active');
            setTimeout(() => inputNewCat && inputNewCat.focus(), 100);
        });
    }

    if (btnCancelCat) {
        btnCancelCat.addEventListener('click', () => {
            modalAddCat.classList.remove('active');
        });
    }

    if (btnConfirmCat) {
        btnConfirmCat.addEventListener('click', () => {
            const catName = (inputNewCat?.value || '').trim();
            if (catName) {
                addCategoryToSelects(catName);
                modalAddCat.classList.remove('active');
                window.showToast(`카테고리 "${catName}"이(가) 추가되었습니다.`, 'success');
            } else {
                window.showToast('카테고리 이름을 입력해주세요.', 'error');
            }
        });
    }

    // Allow Enter key to confirm
    if (inputNewCat) {
        inputNewCat.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') btnConfirmCat && btnConfirmCat.click();
            if (e.key === 'Escape') modalAddCat && modalAddCat.classList.remove('active');
        });
    }



    if (manageCategorySelect) {
        manageCategorySelect.addEventListener('change', (e) => {
            manageCurrentCategory = e.target.value;
            manageCurrentPage = 1;
            if (window.allDocuments) updateDocsList(window.allDocuments);
        });
    }

    if (itemsPerPageSelect) {
        itemsPerPageSelect.addEventListener('change', (e) => {
            manageItemsPerPage = parseInt(e.target.value);
            manageCurrentPage = 1;
            if (window.allDocuments) updateDocsList(window.allDocuments);
        });
    }

    if (btnPrevPage) {
        btnPrevPage.addEventListener('click', () => {
            if (manageCurrentPage > 1) {
                manageCurrentPage--;
                if (window.allDocuments) updateDocsList(window.allDocuments);
            }
        });
    }

    if (btnNextPage) {
        btnNextPage.addEventListener('click', () => {
            manageCurrentPage++;
            if (window.allDocuments) updateDocsList(window.allDocuments);
        });
    }



    // Chat Attachment Logic
    if (btnAttachFile) {
        btnAttachFile.addEventListener('click', () => {
            chatFileUpload.click();
        });
    }

    if (chatFileUpload) {
        chatFileUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                attachedFile = file;
                chatAttachmentName.textContent = file.name;
                chatAttachmentPreview.classList.remove('hidden');
                chatInput.focus();
            }
            // Reset the input so the same file can be selected again if removed
            chatFileUpload.value = '';
        });
    }

    if (btnRemoveAttachment) {
        btnRemoveAttachment.addEventListener('click', () => {
            attachedFile = null;
            chatAttachmentPreview.classList.add('hidden');
            chatAttachmentName.textContent = '';
        });
    }

    async function sendMessage() {
        const queryText = chatInput.value.trim();
        if (!queryText && !attachedFile) return;

        // Check if any ready documents exist (my + public combined)
        const readyDocs = window.allDocuments ? window.allDocuments.filter(d => d.status === 'ready' && d.is_active !== false) : [];
        if (readyDocs.length === 0) {
            appendMessage('assistant', '질문을 시작하기 전에 하나 이상의 문서가 색인을 마치고 준비될 때까지 기다려 주세요.');
            return;
        }

        // Handle attachment and agent logic
        let finalQuery = queryText;
        let attachmentFileName = "";
        let agentFilePaths = [];

        const chatAgentFilter = document.getElementById('chat-agent-filter');
        const selectedAgentId = chatAgentFilter ? chatAgentFilter.value : null;

        if (attachedFile) {
            appendMessage('user', `(파일 첨부: ${attachedFile.name}) ${queryText}`);
            const loaderId = appendLoader("첨부 파일 분석 중...");

            const formData = new FormData();
            formData.append('file', attachedFile);

            if (selectedAgentId) {
                // If Agent mode, upload to temporary sandbox input
                try {
                    const uploadRes = await apiFetch('/api/chat/upload_temp', {
                        method: 'POST',
                        body: formData
                    });
                    if (uploadRes.ok) {
                        const data = await uploadRes.json();
                        agentFilePaths.push(data.filepath);
                        attachmentFileName = attachedFile.name;
                    } else {
                        document.getElementById(loaderId).remove();
                        const errText = await uploadRes.text();
                        appendMessage('assistant', `에이전트 입력을 위한 파일 업로드 실패 (HTTP ${uploadRes.status}: ${errText})`);
                        return;
                    }
                } catch (err) {
                    console.error(err);
                    document.getElementById(loaderId).remove();
                    appendMessage('assistant', '파일 업로드 중 서버 오류가 발생했습니다.');
                    return;
                }
            } else {
                // Standard RAG PDF text extraction
                try {
                    const extRes = await apiFetch('/api/extract_text', {
                        method: 'POST',
                        body: formData
                    });

                    if (extRes.ok) {
                        const data = await extRes.json();
                        finalQuery = `[사용자가 첨부한 문서 내용: ${attachedFile.name}]\n${data.text}\n\n[사용자 질문]: ${queryText}`;
                        attachmentFileName = attachedFile.name;
                    } else {
                        document.getElementById(loaderId).remove();
                        const errText = await extRes.text();
                        appendMessage('assistant', `첨부 파일 텍스트 추출 실패 (HTTP ${extRes.status}: ${errText})`);
                        return;
                    }
                } catch (err) {
                    console.error(err);
                    document.getElementById(loaderId).remove();
                    appendMessage('assistant', '첨부 파일 처리 중 서버 오류가 발생했습니다.');
                    return;
                }
            }

            // clear attachment UI
            btnRemoveAttachment.click();
            document.getElementById(loaderId).remove();
        } else {
            appendMessage('user', queryText);
        }

        chatInput.value = '';
        chatInput.style.height = 'auto';
        sendBtn.disabled = true;

        const isSearchMode = document.getElementById('chat-search-mode')?.checked;
        if (isSearchMode) {
            const loaderId = appendLoader("문서 검색 중...");
            try {
                const response = await apiFetch('/api/search/documents', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: finalQuery, active_docs: activeDocs })
                });

                document.getElementById(loaderId).remove();

                if (response.ok) {
                    const data = await response.json();
                    const docs = data.documents;
                    if (docs && docs.length > 0) {
                        let resultMarkdown = `🔍 **'${queryText}'** 검색 결과 (${docs.length}건)\n\n---\n\n<div style="height: 16px;"></div>\n\n`;
                        docs.forEach(d => {
                            const safeId = d.id.replace(/"/g, '&quot;');
                            let resolvedName = d.name;
                            if (!resolvedName || resolvedName === d.id) {
                                const docInfo = window.allDocuments ? window.allDocuments.find(doc => doc.id === d.id) : null;
                                if (docInfo && docInfo.name) {
                                    resolvedName = docInfo.name;
                                } else {
                                    resolvedName = d.id;
                                }
                            }
                            const safeName = resolvedName.replace(/"/g, '&quot;');

                            const isSelected = window.selectedSearchDocs && window.selectedSearchDocs.has(d.id);
                            const checkedAttr = isSelected ? 'checked' : '';

                            let isWeb = false;
                            let webUrl = "";
                            const _dInfo = window.allDocuments ? window.allDocuments.find(dx => dx.id === d.id) : null;
                            if (_dInfo && _dInfo.file_path) {
                                if (_dInfo.file_path.startsWith('http')) { isWeb = true; webUrl = _dInfo.file_path; }
                                else if (_dInfo.file_path.startsWith('[WEBSITE] ')) { isWeb = true; webUrl = _dInfo.file_path.replace('[WEBSITE] ', '').trim(); }
                            }

                            if (isWeb) {
                                resultMarkdown += `<div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                                    <input type="checkbox" class="doc-search-checkbox" data-doc-id="${safeId}" data-doc-name="${safeName}" title="이 문서를 질의 대상으로 선택" style="cursor: pointer; width: 18px; height: 18px; margin-top: 4px; accent-color: var(--accent-primary);" ${checkedAttr}>
                                    <a href="${webUrl}" target="_blank" class="citation-link web-citation" data-doc="${safeId}" title="${safeName}" style="font-weight: bold; font-size: 1.05rem; cursor: pointer; flex: 1; text-decoration: none; color: var(--accent-primary);">🔗 ${safeName} <span style="font-size:0.8em; font-weight:normal; opacity:0.7;">(${webUrl})</span></a>
                                </div>\n`;
                            } else {
                                resultMarkdown += `<div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                                    <input type="checkbox" class="doc-search-checkbox" data-doc-id="${safeId}" data-doc-name="${safeName}" title="이 문서를 질의 대상으로 선택" style="cursor: pointer; width: 18px; height: 18px; margin-top: 4px; accent-color: var(--accent-primary);" ${checkedAttr}>
                                    <a href="#" class="citation-link" data-doc="${safeId}" data-page="${d.page}" title="${safeName}" style="font-weight: bold; font-size: 1.05rem; cursor: pointer; flex: 1;">📄 ${safeName} (페이지: ${d.page})</a>
                                </div>\n`;
                            }

                            // Remove any markdown headers from the snippet so it renders cleanly in the blockquote
                            let cleanSnippet = d.snippet.replace(/#/g, '');
                            resultMarkdown += `> ${cleanSnippet}\n\n`;

                            // Visual separator with margin for better readability
                            resultMarkdown += `<div style="height: 12px; border-bottom: 1px dashed rgba(255,255,255,0.1); margin-bottom: 16px;"></div>\n\n`;
                        });
                        appendMessage('assistant', resultMarkdown);
                    } else {
                        appendMessage('assistant', `**'${queryText}'**에 대한 검색 결과가 없습니다.`);
                    }
                } else {
                    const err = await response.json().catch(() => ({}));
                    appendMessage('assistant', `검색 중 오류가 발생했습니다: ${err.error || response.status}`);
                }
            } catch (err) {
                document.getElementById(loaderId).remove();
                appendMessage('assistant', `검색 중 네트워크 오류가 발생했습니다.`);
                console.error(err);
            }
            return;
        }

        const loaderId = appendLoader();

        try {
            let requestActiveDocs = [...activeDocs];
            // If the user explicitly selected docs from the search results, ONLY query those!
            if (window.selectedSearchDocs && window.selectedSearchDocs.size > 0) {
                requestActiveDocs = Array.from(window.selectedSearchDocs.keys());
            }

            const requestPayload = {
                query: finalQuery,
                active_docs: requestActiveDocs,
                history: chatHistory,
                session_id: currentSessionId
            };

            if (selectedAgentId) {
                requestPayload.agent_id = selectedAgentId;
                const toggleBtn = document.getElementById('chat-run-sandbox');
                if (toggleBtn && !document.getElementById('chat-sandbox-toggle-container').classList.contains('hidden')) {
                    requestPayload.run_sandbox = toggleBtn.checked;
                }
                if (agentFilePaths.length > 0) {
                    requestPayload.file_paths = agentFilePaths;
                }
            }

            // Optimistically add user query to history
            const cleanQueryForHistory = attachmentFileName ? `(파일 첨부 참조: ${attachmentFileName}) ${queryText}` : queryText;
            chatHistory.push({ role: 'user', content: cleanQueryForHistory });

            // Setup AbortController for Stop Generation
            const controller = new AbortController();
            const signal = controller.signal;

            // Reuse the loader's DOM element for the actual message
            const targetMessageDiv = document.getElementById(loaderId);
            const targetContentDiv = targetMessageDiv.querySelector('.message-content');
            const loaderStatusDiv = targetContentDiv.querySelector('.loader-status');

            // Resize and structure the loader DOM to permanently isolate the Stop button
            const originalCustomMessage = loaderStatusDiv ? loaderStatusDiv.textContent : '답변을 준비하고 있습니다...';
            targetContentDiv.innerHTML = `
                <div class="stream-header" style="display:flex; justify-content:flex-start; align-items:center; gap:10px; margin-bottom:10px;">
                    <button class="btn-stop-stream" style="font-size:0.75rem; padding:3px 8px; border-radius:4px; border:1px solid #cbd5e1; background:#f8fafc; color:#475569; cursor:pointer; font-weight:bold; white-space:nowrap; display:flex; align-items:center; gap:4px;">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg> 중지
                    </button>
                    <div class="loader-status" style="font-size: 0.9em; color: var(--text-secondary); font-weight: 500;">${originalCustomMessage.trim()}</div>
                </div>
                <div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
                <div class="stream-text-container"></div>
            `;

            const stopBtn = targetContentDiv.querySelector('.btn-stop-stream');
            if (stopBtn) {
                stopBtn.onclick = () => {
                    controller.abort();
                    stopBtn.remove();
                };
            }

            const newLoaderStatusDiv = targetContentDiv.querySelector('.loader-status');

            const response = await apiFetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload),
                signal: signal
            });

            if (!response.ok) {
                document.getElementById(loaderId).remove();
                const err = await response.json().catch(() => ({ error: 'Failed to get a response.' }));
                appendMessage('assistant', `Error: ${err.error || 'Failed to get a response.'}`);
                return;
            }

            // Start reading the stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let fullText = "";
            let firstChunk = true;
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // Decode binary chunk and add to buffer
                buffer += decoder.decode(value, { stream: true });

                // Process complete lines from the buffer
                let lines = buffer.split('\n');
                buffer = lines.pop(); // Keep the last incomplete line in the buffer

                for (let line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const parsed = JSON.parse(line);

                        // Handle server status updates (only visible before the first text chunk arrives)
                        if (parsed.type === 'status' && firstChunk && newLoaderStatusDiv) {
                            newLoaderStatusDiv.textContent = parsed.data;
                            chatMessages.scrollTop = chatMessages.scrollHeight;
                        }
                        // Handle actual answer generation chunks
                        else if (parsed.type === 'chunk') {
                            // On first text chunk arrival, clear the typing animation
                            if (firstChunk) {
                                const typingNode = targetContentDiv.querySelector('.typing-indicator');
                                if (typingNode) typingNode.remove();
                                if (newLoaderStatusDiv) newLoaderStatusDiv.remove();
                                firstChunk = false;
                            }

                            fullText += parsed.data;

                            const streamTarget = targetContentDiv.querySelector('.stream-text-container');
                            const atBottom = (chatMessages.scrollHeight - chatMessages.clientHeight <= chatMessages.scrollTop + 50);
                            if (streamTarget) {
                                streamTarget.innerHTML = window.formatAssistantMarkdown(fullText);
                            } else {
                                targetContentDiv.innerHTML = window.formatAssistantMarkdown(fullText);
                            }
                            if (atBottom) {
                                chatMessages.scrollTop = chatMessages.scrollHeight;
                            }
                        }
                        else if (parsed.type === 'message_id') {
                            const msgId = parsed.data;
                            targetMessageDiv.dataset.messageId = msgId;
                            window.addRevisionUI(targetMessageDiv, msgId);
                        }
                        else if (parsed.type === 'hitl_request') {
                            const d = parsed.data;
                            const hitlDiv = document.createElement('div');
                            hitlDiv.className = 'hitl-request-box';
                            hitlDiv.style = "margin-top: 10px; padding: 12px; border: 1px dashed var(--accent); border-radius: 8px; background: rgba(144, 202, 249, 0.05);";

                            let codeSnip = '';
                            if (d.args && typeof d.args === 'object' && d.args.code) {
                                codeSnip = `<strong>코드:</strong> <pre style="font-size: 0.8em; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 4px; margin-top: 4px; max-height: 150px; overflow-y: auto;">${d.args.code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
                            } else {
                                codeSnip = `<strong>파라미터:</strong> <pre style="font-size: 0.8em; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 4px; margin-top: 4px; max-height: 100px; overflow-y: auto;">${JSON.stringify(d.args, null, 2)}</pre>`;
                            }

                            hitlDiv.innerHTML = `
                                <div style="font-weight: 600; color: var(--accent); margin-bottom: 8px;">
                                   <svg width="16" height="16" style="vertical-align:text-bottom;margin-right:4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                                   사용자 승인 대기 중
                                </div>
                                <div style="font-size: 0.9em; margin-bottom: 8px;">
                                    <strong>도구명:</strong> <code>${d.func_name}</code><br>
                                    ${codeSnip}
                                </div>
                                <div style="display: flex; gap: 8px;">
                                    <button class="hitl-btn hitl-approve" style="background:var(--success);color:white;border:none;border-radius:4px;padding:6px 12px;cursor:pointer;flex:1;">✅ 실행 승인</button>
                                    <button class="hitl-btn hitl-deny" style="background:var(--error);color:white;border:none;border-radius:4px;padding:6px 12px;cursor:pointer;flex:1;">❌ 취소(Reject)</button>
                                </div>
                            `;
                            targetContentDiv.appendChild(hitlDiv);
                            chatMessages.scrollTop = chatMessages.scrollHeight;

                            const approveBtn = hitlDiv.querySelector('.hitl-approve');
                            const denyBtn = hitlDiv.querySelector('.hitl-deny');

                            const hitlResolve = async (isApproved) => {
                                approveBtn.disabled = true; denyBtn.disabled = true;
                                approveBtn.style.opacity = '0.5'; denyBtn.style.opacity = '0.5';
                                hitlDiv.style.opacity = '0.5';
                                try {
                                    await fetch('/api/chat/hitl_resolve', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ session_id: currentSessionId, approved: isApproved })
                                    });
                                } catch (e) {
                                    console.error("HITL Error:", e);
                                }
                                hitlDiv.remove();
                            };

                            approveBtn.onclick = () => hitlResolve(true);
                            denyBtn.onclick = () => hitlResolve(false);
                        }
                    } catch (e) {
                        console.error('Failed to parse stream line JSON:', line, e);
                    }
                }
            }

            // Stream complete. Remove the stop button safely.
            if (stopBtn && stopBtn.parentNode) stopBtn.remove();
            targetContentDiv.querySelectorAll('.typing-indicator').forEach(t => t.remove());

            // After stream completes, add copy buttons
            addCopyButtons(targetMessageDiv, targetContentDiv, fullText);

            // Save the assistant's final response to history
            chatHistory.push({ role: 'assistant', content: fullText });

            // Auto-update session title (only needed for the first exchange)
            if (chatHistory.filter(m => m.role === 'user').length === 1 && currentSessionId) {
                apiFetch(`/api/chat/sessions/${currentSessionId}/title`, { method: 'PATCH' })
                    .then(r => r.ok ? r.json() : null)
                    .then(data => {
                        if (data && data.title) {
                            // Update title in allSessions and re-render
                            const s = allSessions.find(x => x.id === currentSessionId);
                            if (s) { s.title = data.title; }
                            renderSessionList();
                        }
                    })
                    .catch(() => { });
            }
            // Always refresh session list to update updated_at ordering
            loadChatHistory();

        } catch (error) {
            const loader = document.getElementById(loaderId);
            if (error.name === 'AbortError') {
                if (loader) {
                    loader.querySelectorAll('.typing-indicator').forEach(t => t.remove());
                    const contentDiv = loader.querySelector('.message-content');
                    if (contentDiv) {
                        const sTarget = contentDiv.querySelector('.stream-text-container');
                        const statusNode = contentDiv.querySelector('.loader-status');

                        // Fallback text dump
                        if (sTarget && sTarget.innerHTML.trim() !== '') {
                            sTarget.innerHTML += '<br><br><span style="color:#64748b;">⚠️ 답변 생성이 중단되었습니다.</span>';
                        } else if (statusNode) {
                            statusNode.innerHTML = '<span style="color:#64748b;">⚠️ 답변 생성이 중단되었습니다.</span>';
                        }
                    }
                }
                return;
            }
            if (loader) loader.remove();
            appendMessage('assistant', `Error: ${error.message}`);
        }
    }

    // Creates an empty message container and returns its ID for streaming updates
    function appendStreamingMessage(content, role) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}-message`;
        msgDiv.id = 'stream-' + Date.now();

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = content; // initial empty

        msgDiv.appendChild(contentDiv);
        chatMessages.appendChild(msgDiv);

        chatMessages.scrollTop = chatMessages.scrollHeight;
        return msgDiv.id;
    }

    window.formatAssistantMarkdown = function (text) {
        let preprocessedContent = text.replace(/\*\*\s*([^\*]+?)\s*\*\*/g, '<strong>$1</strong>');
        preprocessedContent = preprocessedContent.replace(/([^\n>])\s*(#{1,6}\s+)/g, '$1\n\n$2');
        preprocessedContent = preprocessedContent.replace(/(^|\n)(#{1,6})(?=[^\s#])/g, '$1$2 ');

        // Handle website URL citations: [docId#https://...]
        preprocessedContent = preprocessedContent.replace(/\[([a-zA-Z0-9\-_]+)\s*[#\-]\s*(https?:\/\/[^\]\s]+)\]/g, (match, docId, url) => {
            const safeUrl = String(url).replace(/"/g, '&quot;');
            const docInfo = window.allDocuments.find(d => d.id === docId);
            const docName = docInfo ? docInfo.name : `웹페이지: ${docId.substring(0, 5)}...`;
            const safeTitle = String(docName).replace(/"/g, '&quot;');
            return `<a class="citation-link web-citation" href="${safeUrl}" target="_blank" rel="noopener noreferrer" title="${safeTitle} - ${safeUrl}" style="text-decoration: underline; color: var(--accent-primary);">🔗</a>`;
        });

        // Handle PDF document citations: [docId#page]
        const formattedContent = preprocessedContent.replace(/\[([a-zA-Z0-9\-_]+)\s*[#\-]\s*([^\]]+)\]/g, (match, docId, pagePart) => {
            const docInfo = window.allDocuments.find(d => d.id === docId);
            const docName = docInfo ? docInfo.name : `문서: ${docId.substring(0, 5)}...`;
            const safeTitle = String(docName).replace(/"/g, '&quot;');

            // If pagePart is 'Unknown' or a number but the doc is a Website, fallback to the base URL
            if (docInfo && docInfo.file_path && String(docInfo.file_path).startsWith('[WEBSITE] ')) {
                if (pagePart === 'Unknown' || !isNaN(pagePart)) {
                    let url = docInfo.file_path.replace('[WEBSITE] ', '').trim();
                    if (url) {
                        return `<a class="citation-link web-citation" href="${url}" target="_blank" rel="noopener noreferrer" title="${safeTitle} - ${url}" style="text-decoration: underline; color: var(--accent-primary);">🔗</a>`;
                    }
                }
            } else if (docInfo && docInfo.file_path && docInfo.file_path.startsWith('http')) {
                if (pagePart === 'Unknown' || !isNaN(pagePart)) {
                    let url = docInfo.file_path;
                    return `<a class="citation-link web-citation" href="${url}" target="_blank" rel="noopener noreferrer" title="${safeTitle} - ${url}" style="text-decoration: underline; color: var(--accent-primary);">🔗</a>`;
                }
            }

            if (pagePart === 'Unknown') {
                return `<a class="citation-link" data-doc="${docId}" data-page="Unknown" title="${safeTitle}">📄</a>`;
            }
            const pages = String(pagePart).split(',').map(p => p.trim()).filter(p => p);
            const tags = pages.map(p => {
                if (p.startsWith('http://') || p.startsWith('https://')) {
                    const safeUrl = String(p).replace(/"/g, '&quot;');
                    return `<a class="citation-link web-citation" href="${safeUrl}" target="_blank" rel="noopener noreferrer" title="${safeTitle} - ${safeUrl}" style="text-decoration: underline; color: var(--accent-primary);">🔗</a>`;
                }

                let actualDocId = docId;
                let actualPage = p;
                let actualSafeTitle = safeTitle;

                if (p.includes('#')) {
                    const parts = p.split('#');
                    actualDocId = parts[0].trim();
                    actualPage = parts[1].trim();
                    
                    const actualDocInfo = window.allDocuments.find(d => d.id === actualDocId);
                    const docName = actualDocInfo ? actualDocInfo.name : `문서: ${actualDocId.substring(0, 5)}...`;
                    actualSafeTitle = String(docName).replace(/"/g, '&quot;');
                }

                return `<a class="citation-link" data-doc="${actualDocId}" data-page="${actualPage}" title="${actualSafeTitle} (p.${actualPage})">📄${actualPage}</a>`;
            });
            return tags.join(', ');
        });

        // Prevent accidental strikethroughs when LLM uses '~' for ranges (e.g. "15°~40°")
        // We replace single tildes surrounded by non-space/non-tilde characters with their HTML entity.
        const safeContent = formattedContent.replace(/([^\s~])~(?=[^\s~])/g, '$1&#126;');

        return marked.parse(safeContent);
    };

    function appendMessage(role, content, msgId = null, shouldScroll = true) {
        const emptyState = chatMessages.querySelector('.chat-empty-state');
        if (emptyState) emptyState.remove();

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}-message`;
        if (msgId) msgDiv.dataset.messageId = msgId;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        if (role === 'assistant') {
            let versions = [];
            try {
                const parsed = JSON.parse(content);
                if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].text !== undefined) {
                    versions = parsed;
                }
            } catch (e) { }

            window.renderVersionContent = function (versionObj) {
                let html = '';
                if (versionObj.query) {
                    html += `<div style="background:rgba(255,255,255,0.05); padding:8px 12px; border-radius:6px; margin-bottom:12px; font-size:0.9em; border-left: 3px solid var(--accent-primary);">
                                <div style="font-size:0.8em; color:var(--text-secondary); margin-bottom:4px;">보완/수정 요청</div>
                                <div>${escapeHtml(versionObj.query)}</div>
                             </div>`;
                }
                html += window.formatAssistantMarkdown(versionObj.text);
                return html;
            };

            if (versions.length > 1) {
                const tabsHtml = versions.map((v, i) => `<button class="message-tab-btn ${i === versions.length - 1 ? 'active' : ''}" data-idx="${i}" title="${v.query ? escapeHtml(v.query).replace(/"/g, '&quot;') : '원본'}">v${i + 1}</button>`).join('');
                const tabsContainer = document.createElement('div');
                tabsContainer.className = 'message-tabs';
                tabsContainer.innerHTML = tabsHtml;
                msgDiv.appendChild(tabsContainer);

                tabsContainer.querySelectorAll('.message-tab-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        tabsContainer.querySelectorAll('.message-tab-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        const idx = parseInt(btn.dataset.idx);
                        contentDiv.innerHTML = window.renderVersionContent(versions[idx]);
                        addCopyButtons(msgDiv, contentDiv, versions[idx].text);
                    });
                });

                contentDiv.innerHTML = window.renderVersionContent(versions[versions.length - 1]);
                msgDiv.appendChild(contentDiv);
                addCopyButtons(msgDiv, contentDiv, versions[versions.length - 1].text);
            } else {
                const textToRender = versions.length === 1 ? versions[0].text : content;
                const versionToRender = versions.length === 1 ? versions[0] : { text: content };
                contentDiv.innerHTML = window.renderVersionContent(versionToRender);
                msgDiv.appendChild(contentDiv);
                addCopyButtons(msgDiv, contentDiv, textToRender);
            }

            // Render Revise UI if we have a message ID
            if (msgId) {
                window.addRevisionUI(msgDiv, msgId);
            }
        } else {
            contentDiv.textContent = content; // User text as plain
            msgDiv.appendChild(contentDiv);
            addUserActionButtons(msgDiv, content);
        }

        chatMessages.appendChild(msgDiv);

        if (shouldScroll) {
            setTimeout(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }, 50);
        }
    }

    window.addRevisionUI = function (msgDiv, msgId) {
        if (msgDiv.querySelector('.revise-container')) return;

        const placeholderText = window.innerWidth <= 768 ? "어떻게 보완할까요?" : "답변을 어떻게 보완할까요? (예: 더 짧게 요약해줘)";
        const container = document.createElement('div');
        container.className = 'revise-container';
        container.innerHTML = `
            <textarea class="revise-input" placeholder="${placeholderText}" rows="1"></textarea>
            <button class="revise-btn">보완하기</button>
        `;
        msgDiv.appendChild(container);

        const btn = container.querySelector('.revise-btn');
        const input = container.querySelector('.revise-input');

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                btn.click();
            }
        });

        btn.addEventListener('click', () => {
            const q = input.value.trim();
            if (!q || btn.disabled) return;
            window.reviseMessage(msgDiv, msgId, q, btn, input);
        });
    };

    window.reviseMessage = async function (msgDiv, msgId, reviseQuery, btn, input) {
        btn.disabled = true;
        input.disabled = true;
        btn.textContent = '처리 중...';

        try {
            const chatAgentFilter = document.getElementById('chat-agent-filter');
            const selectedAgentId = chatAgentFilter ? chatAgentFilter.value : null;

            const payload = {
                session_id: currentSessionId,
                message_id: msgId,
                revise_query: reviseQuery,
                active_docs: activeDocs,
                history: chatHistory
            };
            if (selectedAgentId) {
                payload.agent_id = selectedAgentId;
                const toggleBtn = document.getElementById('chat-run-sandbox');
                if (toggleBtn && !document.getElementById('chat-sandbox-toggle-container').classList.contains('hidden')) {
                    payload.run_sandbox = toggleBtn.checked;
                }
            }

            // Setup AbortController for Stop Generation
            const controller = new AbortController();
            const signal = controller.signal;

            const response = await apiFetch('/api/chat/revise', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: signal
            });

            if (!response.ok) {
                throw new Error('API Error');
            }

            // We need to dynamically create a new tab and stream into it without destroying the old text
            let tabsContainer = msgDiv.querySelector('.message-tabs');
            let existingTabCount = 1;
            const oldContentDiv = msgDiv.querySelector('.message-content:not([style*="display: none"])') || msgDiv.querySelector('.message-content');

            if (!tabsContainer) {
                // It was a single version message without tabs, so we need to create the tabs UI first!
                tabsContainer = document.createElement('div');
                tabsContainer.className = 'message-tabs';
                tabsContainer.innerHTML = `<button class="message-tab-btn" data-idx="0" title="원본" disabled>v1</button>`;
                msgDiv.insertBefore(tabsContainer, oldContentDiv);
            } else {
                existingTabCount = tabsContainer.querySelectorAll('.message-tab-btn').length;
                tabsContainer.querySelectorAll('.message-tab-btn').forEach(b => {
                    b.classList.remove('active');
                    b.disabled = true; // disable tab switching during stream
                });
            }

            // Add the new tab button for the revision
            const newIdx = existingTabCount;
            const newTabBtn = document.createElement('button');
            newTabBtn.className = 'message-tab-btn active';
            newTabBtn.dataset.idx = newIdx;
            newTabBtn.title = reviseQuery;
            newTabBtn.textContent = `v${newIdx + 1}`;
            tabsContainer.appendChild(newTabBtn);

            // Hide all existing content divs
            msgDiv.querySelectorAll('.message-content').forEach(div => div.style.display = 'none');

            // Create a new content div for the stream
            const newContentDiv = document.createElement('div');
            newContentDiv.className = 'message-content';
            newContentDiv.innerHTML = `
                <div style="background:rgba(255,255,255,0.05); padding:8px 12px; border-radius:6px; margin-bottom:12px; font-size:0.9em; border-left: 3px solid var(--accent-primary);">
                    <div style="display:flex; justify-content:flex-start; align-items:center; gap:10px; margin-bottom:6px;">
                        <button class="btn-stop-stream" style="font-size:0.75rem; padding:3px 8px; border-radius:4px; border:1px solid #cbd5e1; background:#f8fafc; color:#475569; cursor:pointer; font-weight:bold; white-space:nowrap; display:flex; align-items:center; gap:4px;">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg> 중지
                        </button>
                        <div style="font-size:0.8em; color:var(--text-secondary);">보완/수정 요청</div>
                    </div>
                    <div style="color:var(--text-primary);">${escapeHtml(reviseQuery)}</div>
                </div>
                <div class="stream-text-container"><div class="typing-indicator" style="margin-top:10px;"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>
            `;

            // Insert it before the revise container or actions
            const reviseContainer = msgDiv.querySelector('.revise-container');
            if (reviseContainer) {
                msgDiv.insertBefore(newContentDiv, reviseContainer);
            } else {
                msgDiv.appendChild(newContentDiv);
            }

            // Bind the stop button to the controller
            const stopBtn = newContentDiv.querySelector('.btn-stop-stream');
            if (stopBtn) {
                stopBtn.onclick = () => {
                    controller.abort();
                    stopBtn.remove();
                };
            }

            const streamTarget = newContentDiv.querySelector('.stream-text-container');

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let fullText = "";
            let firstChunk = true;
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                let lines = buffer.split('\n');
                buffer = lines.pop();

                for (let line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.type === 'chunk') {
                            if (firstChunk) {
                                streamTarget.innerHTML = "";
                                firstChunk = false;
                            }
                            const atBottom = (chatMessages.scrollHeight - chatMessages.clientHeight <= chatMessages.scrollTop + 50);
                            fullText += parsed.data;
                            streamTarget.innerHTML = window.formatAssistantMarkdown(fullText);
                            if (atBottom) {
                                chatMessages.scrollTop = chatMessages.scrollHeight;
                            }
                        }
                    } catch (e) { }
                }
            }

            // If successful, clean up stop button before reload
            if (stopBtn && stopBtn.parentNode) stopBtn.remove();

            // Once streaming is completely done, the safest way to ensure proper tabs rendering 
            // is to completely reload the session from the backend because the backend just saved the new version!
            // This is clean and avoids complex UI state duplication logic.
            loadSession(currentSessionId, true);

        } catch (error) {
            if (error.name === 'AbortError') {
                const streamTargets = msgDiv.querySelectorAll('.stream-text-container');
                const lastTarget = streamTargets[streamTargets.length - 1];
                if (lastTarget) {
                    const typing = lastTarget.querySelector('.typing-indicator');
                    if (typing) typing.style.display = 'none';
                    if (lastTarget.innerHTML.trim() !== '') {
                        lastTarget.innerHTML += '<br><br><span style="color:#64748b;">⚠️ 답변 보완이 중단되었습니다.</span>';
                    }
                }
                btn.disabled = false;
                input.disabled = false;
                btn.textContent = '보완하기';
                return;
            }
            console.error(error);
            window.showToast('답변 보완 중 오류가 발생했습니다.', 'error');
            btn.disabled = false;
            input.disabled = false;
            btn.textContent = '보완하기';
        }
    };

    function appendLoader(customMessage = "답변을 준비하고 있습니다...") {
        const id = 'loader-' + Date.now();
        const msgDiv = document.createElement('div');
        msgDiv.className = `message assistant-message`;
        msgDiv.id = id;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = `
            <div class="loader-status" style="margin-bottom: 8px; font-size: 0.9em; color: var(--text-secondary); font-weight: 500;">
                ${customMessage}
            </div>
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;

        msgDiv.appendChild(contentDiv);
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        return id;
    }

    function addCopyButtons(msgDiv, contentDiv, rawMarkdown) {
        let actionsDiv = msgDiv.querySelector('.message-actions');
        if (!actionsDiv) {
            actionsDiv = document.createElement('div');
            actionsDiv.className = 'message-actions';
            msgDiv.appendChild(actionsDiv);
            msgDiv.style.flexDirection = 'column';
        } else {
            actionsDiv.innerHTML = '';
        }

        const createToastBtn = (btn, originalHtml, text) => {
            const originalWidth = btn.offsetWidth;
            btn.innerHTML = `<span style="font-size: 0.75rem;">${text}</span>`;
            if (originalWidth > btn.offsetWidth) btn.style.width = originalWidth + 'px';
            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.style.width = 'auto';
            }, 1500);
        };

        // Format markdown to remove Document References for all exports
        const formatMarkdownForExport = (markdown) => {
            if (!markdown) return "";
            
            let exported = markdown.replace(/\ ?\[([a-zA-Z0-9\-_]+)\s*[#\-]\s*(https?:\/\/[^\]]+)\]/g, "");
            exported = exported.replace(/\ ?\[([a-zA-Z0-9\-_]+)\s*[#\-]\s*([^\]]+)\]/g, "");
            return exported;
        };
        const exportMarkdown = formatMarkdownForExport(rawMarkdown);

        // Markdown Button
        const btnMd = document.createElement('button');
        btnMd.className = 'btn-copy';
        btnMd.title = '마크다운 형식으로 복사';
        btnMd.style.padding = '6px';
        btnMd.style.justifyContent = 'center';
        btnMd.style.color = '#a8a29e'; // Stone
        const mdIconHtml = `
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <polyline points="8 17 8 12 12 15 16 12 16 17"></polyline>
            </svg>
        `;
        btnMd.innerHTML = mdIconHtml;
        btnMd.addEventListener('click', () => {
            navigator.clipboard.writeText(exportMarkdown).then(() => {
                createToastBtn(btnMd, mdIconHtml, '복사됨!');
            });
        });

        // Plain text Button
        const btnTxt = document.createElement('button');
        btnTxt.className = 'btn-copy';
        btnTxt.title = '일반 텍스트 형식으로 복사';
        btnTxt.style.padding = '6px';
        btnTxt.style.justifyContent = 'center';
        btnTxt.style.color = '#9ca3af'; // Gray
        const txtIconHtml = `
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="9" y1="12" x2="15" y2="12"></line>
                <line x1="9" y1="16" x2="13" y2="16"></line>
            </svg>
        `;
        btnTxt.innerHTML = txtIconHtml;
        btnTxt.addEventListener('click', () => {
            const clone = contentDiv.cloneNode(true);
            clone.querySelectorAll('.citation-link').forEach(el => el.remove());
            navigator.clipboard.writeText(clone.innerText.trim()).then(() => {
                createToastBtn(btnTxt, txtIconHtml, '복사됨!');
            });
        });

        // DOCX Export Button
        const btnDocx = document.createElement('button');
        btnDocx.className = 'btn-copy';
        btnDocx.title = 'DOCX로 다운로드';
        btnDocx.style.padding = '6px';
        btnDocx.style.justifyContent = 'center';
        btnDocx.style.color = '#60a5fa'; // Blue
        const docxIconHtml = `
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <polyline points="8 12 10 17 12 13 14 17 16 12"></polyline>
            </svg>
        `;
        btnDocx.innerHTML = docxIconHtml;
        btnDocx.addEventListener('click', async () => {
            const originalWidth = btnDocx.offsetWidth;
            btnDocx.disabled = true;
            btnDocx.innerHTML = `<span style="font-size: 0.75rem;">⌛ 다운로드 중...</span>`;
            if (originalWidth > btnDocx.offsetWidth) btnDocx.style.width = originalWidth + 'px';

            try {
                const token = localStorage.getItem('rag_token') || '';
                const res = await fetch('/api/export_docx', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ content: exportMarkdown })
                });

                if (res.ok) {
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `AI_Response_${Date.now()}.docx`;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => {
                        window.URL.revokeObjectURL(url);
                        a.remove();
                    }, 100);
                } else {
                    const errText = await res.text();
                    window.showToast(`문서 생성을 실패했습니다. (상태 코드: ${res.status})`, "error");
                    console.error('DOCX Error:', errText);
                }
            } catch (error) {
                console.error('Error generating DOCX:', error);
                window.showToast(`DOCX 다운로드 중 오류가 발생했습니다.`, "error");
            } finally {
                btnDocx.innerHTML = docxIconHtml;
                btnDocx.style.width = 'auto';
                btnDocx.disabled = false;
            }
        });

        // PPTX Export Button
        const btnPptx = document.createElement('button');
        btnPptx.className = 'btn-copy';
        btnPptx.title = 'PPTX 파워포인트로 다운로드';
        btnPptx.style.padding = '6px';
        btnPptx.style.justifyContent = 'center';
        btnPptx.style.color = '#fb923c'; // Orange
        const pptxIconHtml = `
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <path d="M10 17V12h3a2 2 0 0 1 0 4h-3"></path>
            </svg>
        `;
        btnPptx.innerHTML = pptxIconHtml;
        btnPptx.addEventListener('click', async () => {
            const originalWidth = btnPptx.offsetWidth;
            btnPptx.disabled = true;
            btnPptx.innerHTML = `<span style="font-size: 0.75rem;">⌛ AI 슬라이드 구조화 중...</span>`;
            if (originalWidth > btnPptx.offsetWidth) btnPptx.style.width = originalWidth + 'px';

            try {
                const token = localStorage.getItem('rag_token') || '';
                const res = await fetch('/api/export_pptx', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ content: exportMarkdown })
                });

                if (res.ok) {
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `AI_Presentation_${Date.now()}.pptx`;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => {
                        window.URL.revokeObjectURL(url);
                        a.remove();
                    }, 100);
                } else {
                    const errText = await res.text();
                    window.showToast(`PPTX 생성을 실패했습니다. (상태 코드: ${res.status})`, "error");
                    console.error("PPTX Error: ", errText);
                }
            } catch (error) {
                console.error('Error generating PPTX:', error);
                window.showToast(`PPTX 다운로드 중 오류가 발생했습니다.`, "error");
            } finally {
                btnPptx.innerHTML = pptxIconHtml;
                btnPptx.style.width = 'auto';
                btnPptx.disabled = false;
            }
        });

        // HWPX Export Button
        const btnHwpx = document.createElement('button');
        btnHwpx.className = 'btn-copy';
        btnHwpx.title = '아래아 한글(HWPX)로 다운로드';
        btnHwpx.style.padding = '6px';
        btnHwpx.style.justifyContent = 'center';
        btnHwpx.style.color = '#38bdf8'; // Sky Blue
        const hwpxIconHtml = `
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="9" y1="12" x2="9" y2="17"></line>
                <line x1="15" y1="12" x2="15" y2="17"></line>
                <line x1="9" y1="14.5" x2="15" y2="14.5"></line>
            </svg>
        `;
        btnHwpx.innerHTML = hwpxIconHtml;
        btnHwpx.addEventListener('click', async () => {
            const originalWidth = btnHwpx.offsetWidth;
            btnHwpx.disabled = true;
            btnHwpx.innerHTML = `<span style="font-size: 0.75rem;">⌛ 다운로드 중...</span>`;
            if (originalWidth > btnHwpx.offsetWidth) btnHwpx.style.width = originalWidth + 'px';

            try {
                const token = localStorage.getItem('rag_token') || '';
                const res = await fetch('/api/export_hwpx', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ content: exportMarkdown })
                });

                if (res.ok) {
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `AI_Response_${Date.now()}.hwpx`;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => {
                        window.URL.revokeObjectURL(url);
                        a.remove();
                    }, 100);
                } else {
                    const errText = await res.text();
                    window.showToast(`HWPX 생성을 실패했습니다. (상태 코드: ${res.status})`, "error");
                    console.error("HWPX Error: ", errText);
                }
            } catch (error) {
                console.error('Error generating HWPX:', error);
                window.showToast(`HWPX 다운로드 중 오류가 발생했습니다.`, "error");
            } finally {
                btnHwpx.innerHTML = hwpxIconHtml;
                btnHwpx.style.width = 'auto';
                btnHwpx.disabled = false;
            }
        });

        if (msgDiv.dataset.messageId) {
            const btnEdit = document.createElement('button');
            btnEdit.className = 'btn-copy';
            btnEdit.title = '답변 직접 수정';
            btnEdit.style.padding = '6px';
            btnEdit.style.justifyContent = 'center';
            const editIconHtml = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            `;
            btnEdit.innerHTML = editIconHtml;
            btnEdit.addEventListener('click', () => {
                const currentHtml = contentDiv.innerHTML;

                // Temporarily hide original actions and revise UI during edit
                if (actionsDiv) actionsDiv.style.display = 'none';
                const reviseUi = msgDiv.querySelector('.revise-container');
                if (reviseUi) reviseUi.style.display = 'none';

                const currentHeight = contentDiv.offsetHeight;
                const currentWidth = contentDiv.offsetWidth;
                contentDiv.innerHTML = `
                    <textarea class="edit-assistant-textarea" style="min-width:${currentWidth}px; width:100%; height:${currentHeight}px; min-height:150px; background:var(--bg-secondary); color:var(--text-primary); padding:10px; box-sizing:border-box; border:1px solid var(--border-color); border-radius:8px; font-family:inherit; resize:vertical; line-height:1.5;">${escapeHtml(rawMarkdown)}</textarea>
                    <div style="margin-top:10px; display:flex; justify-content:flex-end; gap:8px;">
                        <button class="btn-primary btn-save-edit" style="flex:0 0 auto; width:auto; padding:6px 16px; font-size:0.9rem; min-width:80px; text-align:center;">저장</button>
                        <button class="btn-secondary btn-cancel-edit" style="flex:0 0 auto; width:auto; padding:6px 16px; font-size:0.9rem; min-width:80px; text-align:center;">취소</button>
                    </div>
                `;

                contentDiv.querySelector('.btn-cancel-edit').addEventListener('click', () => {
                    contentDiv.innerHTML = currentHtml;
                    if (actionsDiv) actionsDiv.style.display = '';
                    if (reviseUi) reviseUi.style.display = '';
                });

                contentDiv.querySelector('.btn-save-edit').addEventListener('click', async (e) => {
                    const newText = contentDiv.querySelector('.edit-assistant-textarea').value;
                    const btn = e.target;
                    btn.disabled = true;
                    btn.textContent = '저장 중...';
                    try {
                        const res = await apiFetch('/api/chat/edit_assistant', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                message_id: msgDiv.dataset.messageId,
                                text: newText,
                                session_id: currentSessionId
                            })
                        });
                        if (res.ok) {
                            loadSession(currentSessionId);
                        } else {
                            window.showToast('수정 실패', 'error');
                            btn.disabled = false;
                            btn.textContent = '저장';
                        }
                    } catch (err) {
                        window.showToast('오류 발생', 'error');
                        btn.disabled = false;
                        btn.textContent = '저장';
                    }
                });
            });
            actionsDiv.appendChild(btnEdit);
        }

        actionsDiv.appendChild(btnMd);
        actionsDiv.appendChild(btnTxt);
        actionsDiv.appendChild(btnDocx);
        actionsDiv.appendChild(btnHwpx);
        actionsDiv.appendChild(btnPptx);
    }

    function addUserActionButtons(msgDiv, content) {
        let actionsDiv = msgDiv.querySelector('.message-actions');
        if (!actionsDiv) {
            actionsDiv = document.createElement('div');
            actionsDiv.className = 'message-actions';
            msgDiv.appendChild(actionsDiv);
            actionsDiv.style.justifyContent = 'flex-end';
        } else {
            actionsDiv.innerHTML = '';
        }

        const createToastBtn = (btn, originalHtml, text) => {
            btn.innerHTML = `<span style="font-size: 0.75rem;">${text}</span>`;
            setTimeout(() => {
                btn.innerHTML = originalHtml;
            }, 1000);
        };

        const btnCopy = document.createElement('button');
        btnCopy.className = 'btn-copy';
        btnCopy.title = '복사';
        btnCopy.style.padding = '6px';
        btnCopy.style.justifyContent = 'center';
        const copyIconHtml = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
        `;
        btnCopy.innerHTML = copyIconHtml;
        btnCopy.addEventListener('click', () => {
            navigator.clipboard.writeText(content).then(() => {
                createToastBtn(btnCopy, copyIconHtml, '복사됨!');
            });
        });

        const btnRetry = document.createElement('button');
        btnRetry.className = 'btn-copy';
        btnRetry.title = '재시도';
        btnRetry.style.padding = '6px';
        btnRetry.style.justifyContent = 'center';
        const retryIconHtml = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
        `;
        btnRetry.innerHTML = retryIconHtml;
        btnRetry.addEventListener('click', () => {
            const chatInput = document.getElementById('chat-input');
            const sendBtn = document.getElementById('send-btn');
            if (chatInput && sendBtn) {
                chatInput.value = content;
                // Programmatically trigger the input event to activate the send button
                chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                sendBtn.click();
            }
        });

        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn-copy';
        btnEdit.title = '편집';
        btnEdit.style.padding = '6px';
        btnEdit.style.justifyContent = 'center';
        const editIconHtml = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
        `;
        btnEdit.innerHTML = editIconHtml;
        btnEdit.addEventListener('click', () => {
            const chatInput = document.getElementById('chat-input');
            if (chatInput) {
                chatInput.value = content;
                // Programmatically trigger the input event to activate the send button
                chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                chatInput.focus();
            }
        });

        actionsDiv.appendChild(btnCopy);
        actionsDiv.appendChild(btnRetry);
        actionsDiv.appendChild(btnEdit);
    }

    // PDF Viewer Logic
    document.addEventListener('click', async (e) => {
        if (e.target.matches('.citation-link:not(.web-citation)')) {
            e.preventDefault();
            const docId = e.target.dataset.doc;
            const page = e.target.dataset.page;
            openPdfViewer(docId, page);
        } else if (e.target.closest('.btn-view')) {
            const btn = e.target.closest('.btn-view');
            const docId = btn.dataset.doc;
            openPdfViewer(docId);
        } else if (e.target.closest('.btn-delete')) {
            const btn = e.target.closest('.btn-delete');
            const docId = btn.dataset.doc;
            const confirmed = await window.showConfirm('정말로 이 문서를 삭제하시겠습니까? 삭제된 문서는 복구할 수 없습니다.', '삭제 확인', '삭제');
            if (confirmed) {
                try {
                    await apiFetch(`/api/documents/${docId}`, { method: 'DELETE' });
                    // Re-poll immediately
                    const res = await apiFetch('/api/documents');
                    if (res.ok) {
                        const data = await res.json();
                        updateDocsList(data);
                    }
                } catch (err) {
                    console.error("Delete error", err);
                }
            }
        } else if (e.target.closest('.btn-reindex')) {
            const btn = e.target.closest('.btn-reindex');
            const docId = btn.dataset.doc;
            const isWebsite = btn.dataset.isWebsite === 'true';
            
            const confirmed = await window.showConfirm(
                isWebsite ? '정말로 이 웹사이트를 재크롤링하시겠습니까?' : '정말로 이 문서를 재인덱싱하시겠습니까?', 
                '재인덱싱 확인', '확인', '취소'
            );
            
            if (confirmed) {
                try {
                    if (isWebsite) {
                        await apiFetch(`/api/websites/${docId}/recrawl`, { 
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ clear_existing: true, strategy: "bfs", max_depth: 3, max_pages: 50 })
                        });
                    } else {
                        await apiFetch(`/api/documents/${docId}/reindex`, { method: 'POST' });
                    }
                    const res = await apiFetch('/api/documents');
                    if (res.ok) {
                        const data = await res.json();
                        updateDocsList(data);
                    }
                } catch (err) {
                    console.error("Reindex error", err);
                }
            }
        } else if (e.target.closest('.btn-stop-reindex')) {
            const btn = e.target.closest('.btn-stop-reindex');
            const docId = btn.dataset.doc;
            const isWebsite = btn.dataset.isWebsite === 'true';
            
            const confirmed = await window.showConfirm('진행 중인 작업을 중단하시겠습니까?', '중단 확인', '중단', '취소');
            if (confirmed) {
                try {
                    if (isWebsite) {
                        await apiFetch(`/api/websites/${docId}/stop`, { method: 'POST' });
                    } else {
                        await apiFetch(`/api/documents/${docId}/stop`, { method: 'POST' });
                    }
                    const res = await apiFetch('/api/documents');
                    if (res.ok) {
                        const data = await res.json();
                        updateDocsList(data);
                    }
                } catch (err) {
                    console.error("Stop error", err);
                }
            }
        }
    });

    // Close PDF Drawer
    function closePdfDrawer() {
        pdfPane.classList.remove('open');
        pdfOverlay.classList.remove('open');
        // Give transition time to finish before clearing src to prevent visual glitch
        setTimeout(() => {
            pdfViewer.src = '';
            pdfOverlay.classList.add('hidden');
        }, 400);
    }

    // Helper: re-fetch documents from server and update view
    async function refreshDocsFromServer() {
        try {
            const res = await apiFetch('/api/documents');
            if (res.ok) {
                const data = await res.json();
                updateDocsList(data); // pass the server object {my_documents, public_documents}
            }
        } catch (err) {
            console.error('Failed to refresh documents from server', err);
        }
    }

    // Inline Category Edit
    document.addEventListener('change', async (e) => {
        if (e.target.matches('.doc-category-edit')) {
            const docId = e.target.dataset.doc;
            const newCategory = e.target.value;

            try {
                const res = await apiFetch(`/api/documents/${docId}/category`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ category: newCategory })
                });
                if (res.ok) {
                    await refreshDocsFromServer();
                } else {
                    const err = await res.json();
                    window.showToast(`카테고리 변경 실패: ${err.error || res.status}`, 'error');
                    await refreshDocsFromServer();
                }
            } catch (err) {
                console.error("Category update error", err);
                window.showToast('카테고리 변경 중 오류가 발생했습니다.', 'error');
            }
        }
    });

    // Inline Active State Edit
    document.addEventListener('change', async (e) => {
        if (e.target.matches('.doc-active-toggle')) {
            const docId = e.target.dataset.doc;
            const isActive = e.target.checked;

            try {
                const res = await apiFetch(`/api/documents/${docId}/active`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_active: isActive })
                });
                if (res.ok) {
                    await refreshDocsFromServer();
                } else {
                    const err = await res.json();
                    window.showToast(`사용 여부 변경 실패: ${err.error || res.status}`, 'error');
                    await refreshDocsFromServer();
                }
            } catch (err) {
                console.error("Active state update error", err);
                window.showToast('사용 여부 변경 중 오류가 발생했습니다.', 'error');
            }
        }
    });

    // Inline Visibility Edit
    document.addEventListener('change', async (e) => {
        if (e.target.matches('.doc-visibility-edit')) {
            const docId = e.target.dataset.doc;
            const newVisibility = e.target.value;
            const prevVisibility = window.allDocuments.find(d => d.id === docId)?.visibility || 'private';

            try {
                const res = await apiFetch(`/api/documents/${docId}/visibility`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ visibility: newVisibility })
                });
                if (res.ok) {
                    const labels = { private: '나만 보기', organization: '조직 공용', public: '전체 공개' };
                    let visibilityStr = labels[newVisibility] || newVisibility;
                    if (newVisibility.startsWith('group_')) {
                        const groupId = parseInt(newVisibility.replace('group_', ''), 10);
                        const sharedGroups = typeof mySharedGroups !== 'undefined' ? mySharedGroups : (window.mySharedGroups || []);
                        const group = sharedGroups.find(g => g.id === groupId);
                        if (group) {
                            visibilityStr = '공유: ' + group.name;
                        }
                    }
                    window.showToast(`공개 설정이 "${visibilityStr}"(으)로 변경되었습니다.`, 'success');
                    await refreshDocsFromServer();
                } else {
                    const err = await res.json();
                    window.showToast(`공개 설정 변경 실패: ${err.error || res.status}`, 'error');
                    e.target.value = prevVisibility;
                }
            } catch (err) {
                console.error('Visibility update error', err);
                window.showToast('공개 설정 변경 중 오류가 발생했습니다.', 'error');
                e.target.value = prevVisibility;
            }
        }
    });

    document.getElementById('close-pdf').addEventListener('click', closePdfDrawer);
    pdfOverlay.addEventListener('click', closePdfDrawer);

    function openPdfViewer(docId, page) {
        let docInfo = window.allDocuments ? window.allDocuments.find(d => d.id === docId) : null;
        if (!docInfo && typeof adminDocsData !== 'undefined') {
            docInfo = adminDocsData.find(d => d.id === docId);
        }
        if (!docInfo || !docInfo.safe_filename) return;

        if (docInfo.safe_filename.endsWith('.url')) {
            let originalUrl = "";
            const fp = docInfo.file_path || "";
            if (fp.startsWith("http")) originalUrl = fp;
            else if (fp.startsWith("[WEBSITE] ")) originalUrl = fp.replace("[WEBSITE] ", "").trim();
            
            if (originalUrl) {
                window.open(originalUrl, '_blank', 'noopener,noreferrer');
            }
            return;
        }

        // Use cache-buster to completely force the iframe to reload and respect `#page=X`
        let url = `/docs/${docInfo.safe_filename}?t=${Date.now()}`;
        if (page && page !== 'Unknown' && page !== 'None') {
            url += `#page=${page}`;
        }

        // Must blank out src before setting to force the inner PDF viewer router to react
        pdfViewer.src = 'about:blank';

        setTimeout(() => {
            const isMobile = window.innerWidth <= 768;
            if (isMobile && docInfo.safe_filename.toLowerCase().endsWith('.pdf')) {
                let pdfFileUrl = `/docs/${docInfo.safe_filename}?t=${Date.now()}`;
                let viewerUrl = `/static/pdfjs/web/viewer.html?file=${encodeURIComponent(pdfFileUrl)}`;
                if (page && page !== 'Unknown' && page !== 'None') {
                    viewerUrl += `#page=${page}`;
                }
                pdfViewer.src = viewerUrl;
            } else {
                pdfViewer.src = url;
            }
            pdfTitle.textContent = docInfo.name;

            pdfPane.classList.remove('hidden');
            pdfOverlay.classList.remove('hidden');

            requestAnimationFrame(() => {
                pdfPane.classList.add('open');
                pdfOverlay.classList.add('open');
            });
        }, 50);
    }

    function createTempDocItem(name, category) {
        const emptyState = docsList.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const li = document.createElement('li');
        li.className = 'doc-item';

        const now = new Date();
        const uploadDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');

        li.innerHTML = `
            <span class="doc-no" style="padding-left: 10px; color: var(--text-secondary);">-</span>
            <div class="doc-name-container">
                <span class="doc-name" title="${name}">${name}</span>
                <span class="doc-description" title="요약문 생성 대기 중...">대기 중...</span>
            </div>
            <span class="doc-category" style="padding-left: 10px;">${category}</span>
            <div class="doc-active" style="text-align: center;"><span style="color: var(--text-secondary);">-</span></div>
            <span class="doc-status"><span class="status-badge indexing">대기 중...</span></span>
            <span class="doc-date">${uploadDate}</span>
            <span class="doc-pages">대기...</span>
            <div class="doc-actions">
                <button class="btn-action" disabled>보기</button>
                <button class="btn-action delete" disabled>삭제</button>
            </div>
        `;
        return li;
    }

    // Polling Document Status
    async function startPollingStatus() {
        if (window.pollingInterval) return;

        const pollOnce = async () => {
            try {
                const res = await apiFetch('/api/documents');
                if (res.ok) {
                    const data = await res.json();
                    // API returns {my_documents, public_documents} — pass the whole object
                    updateDocsList(data);

                    const allDocs = [...(data.my_documents || []), ...(data.public_documents || [])];
                    const allDone = allDocs.length === 0 || allDocs.every(d => d.status === 'ready' || d.status === 'failed');
                    if (allDone) {
                        clearInterval(window.pollingInterval);
                        window.pollingInterval = null;
                    }
                }
            } catch (err) {
                console.error("Polling error", err);
            }
        };

        pollOnce();
        window.pollingInterval = setInterval(pollOnce, 1000);
    }

    function updateDocsList(data) {
        if (!currentUser) {
            console.error("currentUser is not initialized.");
            return;
        }

        // Prevent DOM tearing if user is interacting with form controls (like dropdowns)
        const activeTag = document.activeElement ? document.activeElement.tagName : '';
        if (activeTag === 'SELECT' || activeTag === 'INPUT' && document.activeElement.type !== 'radio') {
            return;
        }

        // Handle both old array format and new object format {my_documents, public_documents}
        if (Array.isArray(data)) {
            const partitioned = { my_documents: [], public_documents: [] };
            data.forEach(doc => {
                // Use string comparison for IDs to avoid any numeric vs string type issues
                const isMyDoc = String(doc.owner_id) === String(currentUser.id);

                if (isMyDoc) {
                    partitioned.my_documents.push(doc);
                } else {
                    // Replication of server-side filtering logic
                    if (currentUser.role === 'admin') {
                        if (doc.visibility !== 'private') partitioned.public_documents.push(doc);
                    } else {
                        if (doc.visibility === 'public') {
                            partitioned.public_documents.push(doc);
                        } else if (doc.visibility === 'organization' && String(doc.organization_id) === String(currentUser.organization_id)) {
                            partitioned.public_documents.push(doc);
                        }
                    }
                }
            });
            window.myDocuments = partitioned.my_documents;
            window.publicDocuments = partitioned.public_documents;
        } else {
            window.myDocuments = data.my_documents || [];
            window.publicDocuments = data.public_documents || [];
        }

        window.allDocuments = [...window.myDocuments, ...window.publicDocuments];
        renderCurrentDocsTab();
    }

    function renderCurrentDocsTab() {
        const docs = currentManageTab === 'my' ? window.myDocuments : window.publicDocuments;
        if (!docs) return;

        const emptyState = docsList.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        docsList.innerHTML = '';
        activeDocs = [];
        
        // Check master checkbox state based on selection? It's fine to keep it intact or let user toggle it.
        // We will no longer clear window.selectedDocs here so checkboxes remain checked during background refresh.
        // Also call updateBulkActionBar to ensure it's still visible if there are selected items.
        updateBulkActionBar();

        // Pre-filter docs for activeDocs
        const chatFilterCats = typeof selectedChatCategories !== 'undefined' ? selectedChatCategories : ['All'];
        let chatAllowedFolders = [];
        if (!chatFilterCats.includes('All') && typeof allFolders !== 'undefined') {
            chatFilterCats.forEach(c => {
                if (c !== 'Public') {
                    chatAllowedFolders = chatAllowedFolders.concat(getDescendantFolderNames(c));
                }
            });
        }

        window.allDocuments.forEach(doc => {
            if (doc.status === 'ready' || doc.status === 'processing') {
                let matchesFolder = false;
                if (chatFilterCats.includes('All')) {
                    matchesFolder = true;
                } else {
                    if (chatFilterCats.includes('Public') && doc.visibility === 'public') {
                        matchesFolder = true;
                    }
                    if (chatAllowedFolders.includes(doc.category)) {
                        matchesFolder = true;
                    }
                }

                if (matchesFolder && doc.is_active !== false) {
                    activeDocs.push(doc.id);
                }
            }
        });

        // Filter for manage view: by folder (currentFolderId) or show all
        let filteredDocs = docs;
        if (currentFolderId !== null) {
            const folderObj = (typeof allFolders !== 'undefined' ? allFolders : []).find(f => f.id === currentFolderId);
            if (folderObj) {
                const manageAllowedFolders = getDescendantFolderNames(folderObj.name);
                filteredDocs = docs.filter(doc => manageAllowedFolders.includes(doc.category));
            }
        }

        // Pagination
        const totalItems = filteredDocs.length;
        const totalPages = Math.ceil(totalItems / manageItemsPerPage) || 1;
        if (manageCurrentPage > totalPages) manageCurrentPage = totalPages;
        if (manageCurrentPage < 1) manageCurrentPage = 1;

        const startIndex = (manageCurrentPage - 1) * manageItemsPerPage;
        const endIndex = startIndex + manageItemsPerPage;
        const paginatedDocs = filteredDocs.slice(startIndex, endIndex);

        // Update pagination UI
        if (pageInfo) {
            pageInfo.textContent = `${manageCurrentPage} / ${totalPages}`;
            btnPrevPage.disabled = manageCurrentPage === 1;
            btnNextPage.disabled = manageCurrentPage === totalPages;
        }

        if (paginatedDocs.length === 0) {
            docsList.innerHTML = '<li class="empty-state">조건에 맞는 문서가 없습니다.</li>';
            return;
        }

        paginatedDocs.forEach((doc, index) => {
            const actualIndex = startIndex + index + 1;
            const li = document.createElement('li');
            li.className = 'doc-item';

            // visually distinguish shared documents in My Documents tab
            if (currentManageTab === 'my' && (doc.visibility === 'public' || doc.visibility === 'organization')) {
                li.classList.add('shared-doc-highlight');
            }

            let statusBadge = '';
            let btnState = 'disabled';
            if (doc.status === 'ready') {
                statusBadge = '<span class="status-badge ready">준비됨</span>';
                btnState = '';
            } else if (doc.status === 'indexing' || doc.status === 'pending' || doc.status === 'processing') {
                const pct = doc.progress_percent || 0;
                const rawText = doc.progress || '처리 중...';
                const shortText = rawText.length > 10 ? rawText.substring(0, 10) + '...' : rawText;
                statusBadge = `
                    <div class="progress-bar-container" title="${rawText}">
                        <div class="progress-bar-fill" style="width: ${pct}%;"></div>
                        <span class="progress-bar-text">${shortText} (${pct}%)</span>
                    </div>
                `;
            } else {
                if (doc.error) console.error(`Document ${doc.name} failed:\n`, doc.error);
                let safeError = doc.error ? String(doc.error).replace(/"/g, '&quot;') : '실패함';
                statusBadge = `<span class="status-badge failed" title="${safeError}">실패 (오류 확인)</span>`;
                btnState = ''; // Allow delete if failed
            }

            // Build Category Select HTML
            const docCat = doc.category || 'General';
            let catOptions = '';
            let foundCat = false;

            // Only owners or admins can edit category and active state
            const canEdit = (currentUser.role === 'admin' || doc.owner_id === currentUser.id);

            let tabFolders = typeof getTabFolders === 'function' ? getTabFolders(currentManageTab) : (typeof allFolders !== 'undefined' ? allFolders : []);
            if (tabFolders.length > 0) {
                tabFolders.forEach(f => {
                    const isSel = f.name === docCat ? 'selected' : '';
                    if (f.name === docCat) foundCat = true;
                    const prefix = f.parent_id === null ? '' : '└ ';
                    catOptions += `<option value="${escapeHtml(f.name)}" ${isSel}>${prefix}${escapeHtml(f.name)}</option>`;
                });
            } else if (uploadCategory && uploadCategory.options) {
                Array.from(uploadCategory.options).forEach(opt => {
                    const isSel = opt.value === docCat ? 'selected' : '';
                    if (opt.value === docCat) foundCat = true;
                    catOptions += `<option value="${opt.value}" ${isSel}>${opt.textContent}</option>`;
                });
            }
            if (!foundCat) {
                catOptions += `<option value="${escapeHtml(docCat)}" selected>${escapeHtml(docCat)}</option>`;
            }

            // In public tab, the folder owner is not me. Display the folder owner name if possible 
            // from the loaded folders list, or fallback to doc's uploader.
            let categoryDisplay = docCat;
            if (currentManageTab === 'public' && typeof allFolders !== 'undefined') {
                const folderObj = allFolders.find(f => f.name === docCat);
                if (folderObj && folderObj.owner_name) {
                    categoryDisplay = `${docCat} <span style="font-size: 0.7rem; color: #64748b;">(${escapeHtml(folderObj.owner_name)})</span>`;
                } else {
                    categoryDisplay = `${docCat} <span style="font-size: 0.7rem; color: #64748b;">(${escapeHtml(doc.uploader_name || '알 수 없음')})</span>`;
                }
            }

            const categoryHTML = canEdit
                ? `<select class="doc-category-edit" data-doc="${doc.id}" style="width: 100%; max-width: 120px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); padding: 4px; border-radius: 4px; outline: none; font-size: 0.85rem;">${catOptions}</select>`
                : `<span style="font-size: 0.85rem; padding-left: 10px;">${categoryDisplay}</span>`;


            const isActive = doc.is_active !== false;
            const activeHTML = canEdit
                ? `<input type="checkbox" class="doc-active-toggle" data-doc="${doc.id}" ${isActive ? 'checked' : ''} style="cursor: pointer; transform: scale(1.2);">`
                : `<span style="font-size: 0.85rem; color: ${isActive ? 'var(--accent-primary)' : 'var(--text-secondary)'};">${isActive ? '사용 중' : '비활성'}</span>`;

            // Build Visibility Select HTML
            const visLabels = { private: '나만 보기', organization: '조직 공용', public: '전체 공개' };
            const docVis = doc.visibility || 'private';

            let groupOptions = '';
            let visDisplay = visLabels[docVis] || docVis;
            // Lookup the shared group name from mySharedGroups
            const sharedGroups = typeof mySharedGroups !== 'undefined' ? mySharedGroups : (window.mySharedGroups || []);
            sharedGroups.forEach(g => {
                const val = 'group_' + g.id;
                const isSelected = docVis === val ? 'selected' : '';
                groupOptions += `<option value="${val}" ${isSelected}>공유: ${escapeHtml(g.name)}</option>`;
                if (docVis === val) visDisplay = '공유: ' + escapeHtml(g.name);
            });

            const visibilityHTML = canEdit
                ? `<select class="doc-visibility-edit" data-doc="${doc.id}" style="width: 100%; max-width: 110px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); padding: 4px; border-radius: 4px; outline: none; font-size: 0.8rem; cursor: pointer;">
                    <option value="private" ${docVis === 'private' ? 'selected' : ''}>나만 보기</option>
                    <option value="organization" ${docVis === 'organization' ? 'selected' : ''}>조직 공용</option>
                    <option value="public" ${docVis === 'public' ? 'selected' : ''}>전체 공개</option>
                    ${groupOptions}
                  </select>`
                : `<span style="font-size: 0.8rem; color: var(--text-secondary);">${visDisplay}</span>`;

            const isWebsiteStr = doc.name.startsWith('[웹사이트]') ? 'true' : 'false';
            
            const viewIcon = '<svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
            const reindexIcon = '<svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
            const stopIcon = '<svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><rect x="6" y="6" width="12" height="12"></rect></svg>';
            const deleteIcon = '<svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>';

            let reindexBtnHtml = '';
            if (canEdit) {
                if (doc.status === 'indexing' || doc.status === 'pending' || doc.status === 'processing') {
                    reindexBtnHtml = `<button class="btn-action btn-stop-reindex" style="color: #ef4444; padding: 6px;" data-doc="${doc.id}" data-is-website="${isWebsiteStr}" title="중단">${stopIcon}</button>`;
                } else if (doc.name.startsWith('[웹사이트]') && (doc.status === 'failed' || doc.error)) {
                    // Website + failed -> Disabled completely (no reindex)
                    reindexBtnHtml = `<button class="btn-action" disabled style="padding: 6px;" title="웹사이트 수집 오류는 재인덱싱할 수 없습니다">${reindexIcon}</button>`;
                } else {
                    // Any other ready/failed for regular doc, OR ready for website -> Active "재인덱싱"
                    reindexBtnHtml = `<button class="btn-action btn-reindex" style="color: #38bdf8; padding: 6px;" data-doc="${doc.id}" data-is-website="${isWebsiteStr}" title="재인덱싱">${reindexIcon}</button>`;
                }
            }

            const viewBtnState = doc.status !== 'ready' ? 'disabled' : '';
            const viewBtnClass = viewBtnState ? 'style="padding: 6px;"' : 'style="color: var(--accent-primary); padding: 6px;"';
            const viewBtnHtml = `<button class="btn-action btn-view" data-doc="${doc.id}" title="보기" ${viewBtnState} ${viewBtnClass}>${viewIcon}</button>`;

            const deleteBtnHtml = canEdit
                ? `<button class="btn-action btn-delete delete" style="color: #ef4444; padding: 6px;" data-doc="${doc.id}" title="삭제">${deleteIcon}</button>`
                : `<button class="btn-action" disabled style="padding: 6px;" title="삭제 권한이 없습니다">${deleteIcon}</button>`;

            const isChecked = window.selectedDocs.has(doc.id) ? 'checked' : '';
            li.innerHTML = `
                <div class="doc-chk" style="padding-left: 10px; width: 40px; text-align: center; margin-top: -2px;">
                    <input type="checkbox" class="doc-select-checkbox" data-doc="${doc.id}" ${isChecked} style="cursor: pointer;">
                </div>
                <span class="doc-no" style="padding-left: 10px; color: var(--text-secondary);">${actualIndex}</span>
                <div class="doc-name-container">
                    <span class="doc-name" title="${escapeHtml(doc.name)}">
                        ${doc.name.startsWith('[웹사이트]') ? '🌐 ' + escapeHtml(doc.name.replace('[웹사이트] ', '')) : '📄 ' + escapeHtml(doc.name)}
                    </span>
                    <span class="doc-description" title="${escapeHtml(doc.doc_description || '요약문 없음')}">${escapeHtml(doc.doc_description || '요약문 없음')}</span>
                </div>
                <div class="doc-uploader" style="padding-left: 10px; display: flex; flex-direction: column; justify-content: center;">
                    <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${escapeHtml(doc.uploader_name || '알 수 없음')}</span>
                    <span style="font-size: 0.75rem; color: var(--text-secondary);">${escapeHtml(doc.uploader_org || '팀 미상')}</span>
                </div>
                <div class="doc-category" style="padding: 0 10px;">${categoryHTML}</div>
                <div style="display: flex; justify-content: center; align-items: center;">${visibilityHTML}</div>
                <div class="doc-active" style="display: flex; justify-content: center; align-items: center;">${activeHTML}</div>
                <span class="doc-status">${statusBadge}</span>
                <span class="doc-date">${doc.upload_date}</span>
                <span class="doc-pages">${doc.page_count}</span>
                <div class="doc-actions">
                    ${viewBtnHtml}
                    ${reindexBtnHtml}
                    ${deleteBtnHtml}
                </div>
            `;
            docsList.appendChild(li);
        });
    }

    // ─────────────────────────────────────────────────────
    // Chat Session Management
    // ─────────────────────────────────────────────────────

    /** Format a UTC ISO datetime string to a short time/date label */
    function formatSessionTime(ts) {
        if (!ts) return '';
        const d = new Date(ts + (ts.includes('Z') || ts.includes('+') ? '' : 'Z'));
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const diffDays = Math.round((today - day) / 86400000);
        if (diffDays === 0) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        if (diffDays === 1) return '어제';
        return `${d.getMonth() + 1}/${d.getDate()}`;
    }

    /** Return date group label for a session */
    function getDateGroup(ts) {
        if (!ts) return '이전';
        const d = new Date(ts + (ts.includes('Z') || ts.includes('+') ? '' : 'Z'));
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const diffDays = Math.round((today - day) / 86400000);
        if (diffDays === 0) return '오늘';
        if (diffDays === 1) return '어제';
        if (diffDays <= 7) return '이전 7일';
        if (diffDays <= 30) return '이전 30일';
        return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월';
    }

    /** Render the sidebar session list */
    function renderSessionList() {
        if (!chatSessionList) return;
        chatSessionList.innerHTML = '';

        const sessions = showingAllSessions
            ? allSessions
            : allSessions.slice(0, SESSION_PREVIEW_COUNT);

        if (sessions.length === 0) {
            chatSessionList.innerHTML = '<div style="padding:8px 6px;font-size:0.82rem;color:var(--text-secondary);opacity:0.6;">대화 기록이 없습니다.</div>';
        }

        let lastGroup = null;
        let groupEl = null;

        sessions.forEach(session => {
            const group = session.is_pinned ? '📌 고정됨' : getDateGroup(session.updated_at);
            if (group !== lastGroup) {
                groupEl = document.createElement('div');
                groupEl.className = 'history-date-group';
                const label = document.createElement('span');
                label.className = 'history-date-label';
                label.textContent = group;
                groupEl.appendChild(label);
                chatSessionList.appendChild(groupEl);
                lastGroup = group;
            }

            const item = document.createElement('div');
            item.className = 'history-session-item' + (session.id === currentSessionId ? ' active' : '') + (session.is_pinned ? ' pinned' : '');
            item.dataset.sessionId = session.id;

            const title = document.createElement('span');
            title.className = 'history-session-title';
            title.textContent = session.title || '새 대화';

            const pinBtn = document.createElement('button');
            pinBtn.className = 'btn-pin-session' + (session.is_pinned ? ' active' : '');
            pinBtn.title = session.is_pinned ? '고정 해제' : '상단 고정';
            pinBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="${session.is_pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
            pinBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await togglePinSession(session.id, !session.is_pinned);
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-delete-session';
            delBtn.title = '삭제';
            delBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await deleteSession(session.id);
            });

            item.appendChild(title);
            item.appendChild(pinBtn);
            item.appendChild(delBtn);
            item.addEventListener('click', () => loadSession(session.id));
            groupEl.appendChild(item);
        });

        // "모든 채팅 보기" button
        if (btnShowAllSessions) {
            if (!showingAllSessions && allSessions.length > SESSION_PREVIEW_COUNT) {
                btnShowAllSessions.classList.remove('hidden');
                btnShowAllSessions.textContent = `모든 채팅 보기 (${allSessions.length}개)`;
            } else if (showingAllSessions && allSessions.length > SESSION_PREVIEW_COUNT) {
                btnShowAllSessions.classList.remove('hidden');
                btnShowAllSessions.textContent = '최근 채팅만 보기';
            } else {
                btnShowAllSessions.classList.add('hidden');
            }
        }
    }

    /** Fetch sessions list and render */
    async function loadChatHistory() {
        try {
            const res = await apiFetch('/api/chat/sessions');
            if (res.ok) {
                const data = await res.json();
                allSessions = data.sessions || [];
                renderSessionList();
            }
        } catch (err) { console.error('Session list load error', err); }
    }

    /** Load messages for a specific session into the chat area */
    async function loadSession(sessionId, preserveScroll = false) {
        currentSessionId = sessionId;
        const prevScrollTop = chatMessages.scrollTop;
        chatHistory = [];
        if (typeof clearChatMessages === 'function') {
            clearChatMessages();
        } else {
            chatMessages.innerHTML = '';
        }

        // Highlight active item
        document.querySelectorAll('.history-session-item').forEach(el => {
            el.classList.toggle('active', el.dataset.sessionId === sessionId);
        });

        // Switch to chat tab
        switchTab('chat');

        try {
            const res = await apiFetch(`/api/chat/sessions/${sessionId}/messages?t=${Date.now()}`);
            if (res.ok) {
                const data = await res.json();
                const msgs = data.messages || [];
                msgs.forEach(msg => {
                    appendMessage(msg.role, msg.content, msg.id, false);
                    chatHistory.push({ role: msg.role, content: msg.content });
                });
                if (preserveScroll) {
                    chatMessages.scrollTop = prevScrollTop;
                } else {
                    // scroll to bottom
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
            }
        } catch (err) { console.error('Load session messages error', err); }
    }

    /** Delete a session by id */
    async function deleteSession(sessionId) {
        const confirmed = await window.showConfirm('이 대화를 삭제하시겠습니까?', '대화 삭제', '삭제', '취소');
        if (!confirmed) return;
        try {
            const res = await apiFetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
            if (res.ok) {
                allSessions = allSessions.filter(s => s.id !== sessionId);
                renderSessionList();
                // If deleted active session, clear chat
                if (sessionId === currentSessionId) {
                    await startNewSession();
                }
                window.showToast('대화가 삭제되었습니다.', 'success');
            } else {
                window.showToast('삭제 실패', 'error');
            }
        } catch (err) { console.error(err); }
    }

    /** Toggle pin status for a session */
    async function togglePinSession(sessionId, isPinned) {
        try {
            const res = await apiFetch(`/api/chat/sessions/${sessionId}/pin`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_pinned: isPinned })
            });
            if (res.ok) {
                await loadChatHistory();
            } else {
                window.showToast('고정 상태 변경 실패', 'error');
            }
        } catch (err) { console.error(err); }
    }

    function clearChatMessages() {
        if (!chatMessages) return;
        chatMessages.innerHTML = `
            <div class="chat-empty-state">
                <h2 class="kms-anim-text">
                    <span class="kms-char" style="--i:1">지</span>
                    <span class="kms-char" style="--i:2">능</span>
                    <span class="kms-char" style="--i:3">형</span>
                    <span class="kms-char" style="--i:4">&nbsp;</span>
                    <span class="kms-char" style="--i:5">지</span>
                    <span class="kms-char" style="--i:6">식</span>
                    <span class="kms-char" style="--i:7">관</span>
                    <span class="kms-char" style="--i:8">리</span>
                    <span class="kms-char" style="--i:9">시</span>
                    <span class="kms-char" style="--i:10">스</span>
                    <span class="kms-char" style="--i:11">템</span>
                </h2>
                <div class="empty-text">무엇이든 편하게 질문해 주세요.</div>
            </div>
        `;
    }

    /** Create a new session and clear chat UI */
    async function startNewSession() {
        try {
            const res = await apiFetch('/api/chat/sessions', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                currentSessionId = data.session_id;
                chatHistory = [];
                if (chatMessages) clearChatMessages();
                // Refresh session list
                await loadChatHistory();
            }
        } catch (err) {
            console.error('Create session error', err);
        }
    }

    // Wire up "새 대화" button globally to bypass event listening issues
    window.handleNewChatClick = async (e) => {
        if (e) e.preventDefault();
        try {
            switchTab('chat');
            await startNewSession();
        } catch (err) {
            console.error('Error in new chat:', err);
            alert('새 채팅 시작 중 오류: ' + (err.message || '알 수 없는 오류'));
        }
    };

    // Wire up "모든 채팅 보기" toggle
    if (btnShowAllSessions) {
        btnShowAllSessions.addEventListener('click', () => {
            showingAllSessions = !showingAllSessions;
            renderSessionList();
        });
    }

    // Wire up "전체 대화 삭제" button
    const btnDeleteAllSessions = document.getElementById('btn-delete-all-sessions');
    if (btnDeleteAllSessions) {
        btnDeleteAllSessions.addEventListener('click', async () => {
            const ok = await window.showConfirm('정말 모든 대화 기록을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.', '전체 삭제', '삭제');
            if (ok) {
                try {
                    const res = await apiFetch('/api/chat/sessions', { method: 'DELETE' });
                    if (res.ok) {
                        window.showToast('모든 대화 기록이 삭제되었습니다.', 'success');
                        chatHistory = [];
                        renderSessionList();
                        if (chatMessages) clearChatMessages();
                        currentSessionId = null;
                        await startNewSession();
                    } else {
                        const err = await res.json();
                        window.showToast('삭제 실패: ' + (err.error || '알 수 없는 오류'), 'error');
                    }
                } catch (e) {
                    console.error('Delete all error:', e);
                    window.showToast('삭제 요청 중 오류가 발생했습니다.', 'error');
                }
            }
        });
    }

    // Wire up search filter
    const sessionSearchInput = document.getElementById('session-search-input');
    if (sessionSearchInput) {
        sessionSearchInput.addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            document.querySelectorAll('.history-session-item').forEach(item => {
                const title = item.querySelector('.history-session-title')?.textContent?.toLowerCase() || '';
                item.style.display = q === '' || title.includes(q) ? '' : 'none';
            });
            // Also hide empty date groups
            document.querySelectorAll('.history-date-group').forEach(group => {
                const hasVisible = [...group.querySelectorAll('.history-session-item')].some(i => i.style.display !== 'none');
                group.style.display = hasVisible ? '' : 'none';
            });
        });
    }

    // --- Admin Functions ---
    // Rename Org Modal State
    let targetRenameOrgId = null;
    const modalRenameOrg = document.getElementById('modal-rename-org');
    const inputRenameOrg = document.getElementById('input-rename-org');
    const btnCancelRenameOrg = document.getElementById('btn-cancel-rename-org');
    const btnConfirmRenameOrg = document.getElementById('btn-confirm-rename-org');

    if (btnCancelRenameOrg) {
        btnCancelRenameOrg.addEventListener('click', () => {
            modalRenameOrg.classList.remove('active');
            targetRenameOrgId = null;
        });
    }

    if (btnConfirmRenameOrg) {
        btnConfirmRenameOrg.addEventListener('click', async () => {
            if (!targetRenameOrgId) return;
            const newName = inputRenameOrg.value.trim();
            if (!newName) {
                window.showToast('조직 이름을 입력해주세요.', 'error');
                return;
            }

            try {
                const res = await apiFetch(`/api/admin/organizations/${targetRenameOrgId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newName })
                });

                if (res.ok) {
                    window.showToast('조직 이름이 변경되었습니다.', 'success');
                    modalRenameOrg.classList.remove('active');
                    loadAdminOrgs();
                } else {
                    const err = await res.json();
                    window.showToast(`변경 실패: ${err.error}`, 'error');
                }
            } catch (error) {
                console.error(error);
                window.showToast('조직 변경 중 오류가 발생했습니다.', 'error');
            }
        });
    }

    async function loadAdminOrgs() {
        try {
            const res = await apiFetch('/api/admin/organizations');
            if (!res.ok) return;
            const data = await res.json();
            const orgs = data.organizations || [];

            // Populate select dropdowns
            const parentSelect = document.getElementById('admin-org-parent');
            const userOrgSelect = document.getElementById('admin-user-org');

            if (parentSelect) {
                parentSelect.innerHTML = '<option value="">-- 최상위 조직 --</option>';
                orgs.forEach(o => parentSelect.innerHTML += `<option value="${o.id}">${o.name}</option>`);
            }
            if (userOrgSelect) {
                userOrgSelect.innerHTML = '';
                orgs.forEach(o => userOrgSelect.innerHTML += `<option value="${o.id}">${o.name}</option>`);
            }

            // Build Tree
            const treeContainer = document.getElementById('org-tree-container');
            if (!treeContainer) return;
            treeContainer.innerHTML = '';

            // Convert to hierarchical map
            const treeMap = {};
            const roots = [];
            orgs.forEach(o => { o.children = []; treeMap[o.id] = o; });
            orgs.forEach(o => {
                if (o.parent_id && treeMap[o.parent_id]) {
                    treeMap[o.parent_id].children.push(o);
                } else {
                    roots.push(o);
                }
            });

            function renderTree(nodes) {
                let html = '';
                nodes.forEach(n => {
                    const isLeaf = n.children.length === 0;

                    html += `<details class="org-node" ${isLeaf ? '' : 'open'}>`;
                    html += `
                        <summary>
                            <div class="org-summary-content">
                                <span>
                                    ${isLeaf ? '📄' : '📁'} <strong style="margin-left:5px;">${n.name}</strong> 
                                </span>
                                <div class="org-actions" style="display: flex; gap: 4px;">
                                    <button class="btn-action btn-edit-org" data-id="${n.id}" data-name="${n.name}" style="padding: 2px 6px; font-size: 0.8rem;" onclick="event.preventDefault();">이름 변경</button>
                                    <button class="btn-action delete btn-delete-org" data-id="${n.id}" style="padding: 2px 6px; font-size: 0.8rem;" onclick="event.preventDefault();">삭제</button>
                                </div>
                            </div>
                        </summary>
                    `;

                    if (!isLeaf) {
                        html += `<div class="org-children">`;
                        html += renderTree(n.children);
                        html += `</div>`;
                    }
                    html += `</details>`;
                });
                return html;
            }

            if (roots.length === 0) {
                treeContainer.innerHTML = '<p style="color: var(--text-secondary);">조직이 비어있습니다.</p>';
            } else {
                treeContainer.innerHTML = renderTree(roots);

                // Attach rename listeners
                treeContainer.querySelectorAll('.btn-edit-org').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        const id = e.target.dataset.id;
                        const oldName = e.target.dataset.name;
                        targetRenameOrgId = id;
                        inputRenameOrg.value = oldName;
                        modalRenameOrg.classList.add('active');
                        inputRenameOrg.focus();
                    });
                });

                // Attach delete listeners
                treeContainer.querySelectorAll('.btn-delete-org').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        const id = e.target.dataset.id;
                        const ok = await window.showConfirm(`정말로 조직 ID ${id}를 삭제하시겠습니까? (하위 조직이나 속한 사용자가 있으면 삭제할 수 없습니다.)`, '조직 삭제', '삭제');
                        if (ok) {
                            try {
                                const dr = await apiFetch(`/api/admin/organizations/${id}`, { method: 'DELETE' });
                                if (dr.ok) {
                                    window.showToast('조직이 정상적으로 삭제되었습니다.', 'success');
                                    loadAdminOrgs();
                                }
                                else {
                                    const de = await dr.json();
                                    window.showToast(`삭제 실패: ${de.error}`, 'error');
                                }
                            } catch (err) { console.error(err); }
                        }
                    });
                });
            }
        } catch (err) { console.error('Failed to load orgs', err); }
    }

    // Refresh Button Listener
    const btnRefreshDocs = document.getElementById('btn-refresh-docs');
    if (btnRefreshDocs) {
        btnRefreshDocs.addEventListener('click', async () => {
            btnRefreshDocs.disabled = true;
            btnRefreshDocs.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
                    <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg> 새로고침 중...
            `;
            try {
                const res = await apiFetch('/api/documents');
                if (res.ok) {
                    const data = await res.json();
                    updateDocsList(data);
                    window.showToast('문서 목록이 동기화되었습니다.', 'success');
                }
            } catch (err) {
                console.error(err);
                window.showToast('새로고침 중 오류가 발생했습니다.', 'error');
            } finally {
                btnRefreshDocs.disabled = false;
                btnRefreshDocs.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg> 새로고침
                `;
            }
        });
    }

    // Toggle Manage Area Header
    const btnToggleManageHeader = document.getElementById('btn-toggle-manage-header');
    const iconToggleHeader = document.getElementById('icon-toggle-header');

    if (btnToggleManageHeader && manageArea && iconToggleHeader) {
        // Load layout state if any
        if (localStorage.getItem('manageAreaCollapsed') === 'true') {
            manageArea.classList.add('tabs-collapsed');
            iconToggleHeader.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>'; // down chevron
        }

        btnToggleManageHeader.addEventListener('click', () => {
            manageArea.classList.toggle('tabs-collapsed');
            const isCollapsed = manageArea.classList.contains('tabs-collapsed');
            localStorage.setItem('manageAreaCollapsed', isCollapsed);

            if (isCollapsed) {
                iconToggleHeader.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>'; // down chevron
            } else {
                iconToggleHeader.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>'; // up chevron
            }
        });
    }

    // Toggle Folder Tree Panel
    const collapseTreeBtns = document.querySelectorAll('.btn-collapse-tree');
    collapseTreeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const panel = e.target.closest('.folder-tree-panel');
            if (panel) {
                panel.classList.toggle('collapsed');
                let storageKey = 'folderTreeCollapsed';
                if (panel.closest('#manage-groups-body')) storageKey = 'groupsTreeCollapsed';
                else if (panel.closest('#agents-area')) storageKey = 'agentTreeCollapsed';
                localStorage.setItem(storageKey, panel.classList.contains('collapsed'));
            }
        });
    });

    // Load initial state for folder trees
    const folderTreePanelObj = document.getElementById('folder-tree-panel');
    if (folderTreePanelObj && localStorage.getItem('folderTreeCollapsed') === 'true') {
        folderTreePanelObj.classList.add('collapsed');
    }
    const groupsTreePanelObj = document.querySelector('#manage-groups-body .folder-tree-panel');
    if (groupsTreePanelObj && localStorage.getItem('groupsTreeCollapsed') === 'true') {
        groupsTreePanelObj.classList.add('collapsed');
    }
    const agentTreePanelObj = document.querySelector('#agents-area .folder-tree-panel');
    if (agentTreePanelObj && localStorage.getItem('agentTreeCollapsed') === 'true') {
        agentTreePanelObj.classList.add('collapsed');
    }


    async function loadAdminUsers() {
        try {
            const res = await apiFetch('/api/admin/users');
            const orgRes = await apiFetch('/api/admin/organizations');
            if (!res.ok || !orgRes.ok) return;

            const data = await res.json();
            const orgData = await orgRes.json();
            const users = data.users || [];
            const orgs = orgData.organizations || [];
            const orgMap = {};
            orgs.forEach(o => orgMap[o.id] = o.name);

            const tbody = document.getElementById('admin-users-list');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--text-secondary);">사용자가 없습니다.</td></tr>';
                return;
            }

            users.forEach(u => {
                const isAdmin = u.role === 'admin';
                const isMainAdmin = u.username === 'admin';

                const deleteBtnHtml = isMainAdmin
                    ? `<button class="btn-action" disabled title="기본 관리자는 삭제할 수 없습니다">삭제</button>`
                    : `<button class="btn-action delete btn-delete-user" data-id="${u.id}">삭제</button>`;

                const activeHtml = isMainAdmin
                    ? `<span style="color: var(--accent-primary);">사용 중 (고정)</span>`
                    : `<input type="checkbox" class="admin-user-active-toggle" data-id="${u.id}" ${u.is_active ? 'checked' : ''} style="cursor: pointer;"> <label style="font-size: 0.85rem;">사용 중</label>`;

                let orgSelectHtml = '';
                if (isMainAdmin) {
                    orgSelectHtml = `<span style="color: var(--text-secondary);">${orgMap[u.organization_id] || u.organization_id} (고정)</span>`;
                } else {
                    let opts = '';
                    orgs.forEach(o => {
                        opts += `<option value="${o.id}" ${o.id === u.organization_id ? 'selected' : ''}>${o.name}</option>`;
                    });
                    orgSelectHtml = `<select class="admin-user-org-edit" data-id="${u.id}" style="width: 100%; max-width: 150px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); padding: 4px; border-radius: 4px; outline: none; font-size: 0.85rem;">${opts}</select>`;
                }

                tbody.innerHTML += `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 10px;">
                            ${isAdmin ? '<span title="관리자">🛡️</span> ' : '👤 '}
                            <strong>${u.username}</strong>
                        </td>
                        <td style="padding: 10px; color: var(--text-primary); font-weight: 500;">
                            ${u.full_name || '<span style="color: var(--text-secondary); font-size: 0.85rem; font-weight: 400;">미등록</span>'}
                        </td>
                        <td style="padding: 10px;">${orgSelectHtml}</td>
                        <td style="padding: 10px;">${activeHtml}</td>
                        <td style="padding: 10px; display: flex; gap: 8px;">
                            ${isMainAdmin ? '<button class="btn-action edit" disabled title="기본 관리자는 편집할 수 없습니다">수정</button>' : `<button class="btn-action edit btn-edit-user" data-id="${u.id}" data-username="${u.username}" data-fullname="${u.full_name || ''}" data-isadmin="${isAdmin}">수정</button>`}
                            ${deleteBtnHtml}
                        </td>
                    </tr>
                `;
            });

            // Attach toggle handlers
            tbody.querySelectorAll('.admin-user-active-toggle').forEach(chk => {
                chk.addEventListener('change', async (e) => {
                    const id = e.target.dataset.id;
                    const isActive = e.target.checked;
                    try {
                        const rr = await apiFetch(`/api/admin/users/${id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ is_active: isActive })
                        });
                        if (!rr.ok) {
                            const re = await rr.json();
                            window.showToast(`상태 업데이트 실패: ${re.error}`, 'error');
                            e.target.checked = !isActive;
                        } else {
                            window.showToast('사용자 상태가 업데이트되었습니다.', 'success');
                        }
                    } catch (err) { console.error(err); e.target.checked = !isActive; window.showToast('상태 업데이트 오류', 'error'); }
                });
            });

            // Attach organization change handlers
            tbody.querySelectorAll('.admin-user-org-edit').forEach(sel => {
                sel.addEventListener('change', async (e) => {
                    const id = e.target.dataset.id;
                    const newOrgId = parseInt(e.target.value, 10);
                    const prevVal = e.target.getAttribute('data-prev-val') || newOrgId;

                    try {
                        const rr = await apiFetch(`/api/admin/users/${id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ organization_id: newOrgId })
                        });
                        if (!rr.ok) {
                            const re = await rr.json();
                            window.showToast(`조직 변경 실패: ${re.error}`, 'error');
                            e.target.value = prevVal; // rollback
                        } else {
                            e.target.setAttribute('data-prev-val', newOrgId);
                            window.showToast('사용자의 조직이 변경되었습니다.', 'success');
                        }
                    } catch (err) {
                        console.error(err);
                        e.target.value = prevVal;
                        window.showToast('조직 변경 오류', 'error');
                    }
                });
                // Store initial value
                sel.setAttribute('data-prev-val', sel.value);
            });

            // Attach edit handlers
            tbody.querySelectorAll('.btn-edit-user').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = e.target.dataset.id;
                    const username = e.target.dataset.username;
                    const fullname = e.target.dataset.fullname;
                    const isAdmin = e.target.dataset.isadmin === 'true';

                    const overlay = document.createElement('div');
                    overlay.className = 'modal-overlay active';
                    overlay.innerHTML = `
                        <div class="modal-content" style="max-width: 400px; z-index: 10001; position: relative; background: var(--bg-secondary); border-radius: 8px; padding: 20px;">
                            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 10px; margin-bottom: 15px;">
                                <h3 style="margin: 0; font-size: 1.1rem; color: var(--text-primary);">사용자 수정: ${username}</h3>
                                <button class="btn-close-modal" style="background: none; border: none; font-size: 1.2rem; cursor: pointer; color: var(--text-secondary);">&times;</button>
                            </div>
                            <div class="modal-body" style="display: flex; flex-direction: column; gap: 15px;">
                                <div class="input-group">
                                    <label style="display: block; margin-bottom: 5px; font-size: 0.9rem; color: var(--text-secondary);">이름 (Real Name)</label>
                                    <input type="text" id="edit-user-fullname" class="input-text" style="width: 100%; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); border-radius: 4px; padding: 8px;" value="${fullname}">
                                </div>
                                <div class="input-group">
                                    <label style="display: block; margin-bottom: 5px; font-size: 0.9rem; color: var(--text-secondary);">새 비밀번호 (변경시에만 입력)</label>
                                    <input type="password" id="edit-user-password" class="input-text" style="width: 100%; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); border-radius: 4px; padding: 8px;" placeholder="새 비밀번호 입력">
                                </div>
                                <div class="input-group" style="display: flex; align-items: center; gap: 8px;">
                                    <input type="checkbox" id="edit-user-isadmin" style="width: 16px; height: 16px; cursor: pointer; margin: 0; accent-color: var(--accent-primary);" ${isAdmin ? 'checked' : ''}>
                                    <label for="edit-user-isadmin" style="margin: 0; cursor: pointer; color: var(--text-primary); font-size: 0.9rem;">관리자 권한 부여</label>
                                </div>
                            </div>
                            <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
                                <button class="btn-secondary btn-cancel-edit" style="flex: 1; padding: 10px 16px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; text-align: center;">취소</button>
                                <button class="btn-primary btn-save-edit" style="flex: 1; padding: 10px 16px; background: var(--accent-primary); color: white; border: none; border-radius: 4px; cursor: pointer; text-align: center;">저장</button>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(overlay);

                    const closeFn = () => document.body.removeChild(overlay);

                    overlay.querySelector('.btn-close-modal').addEventListener('click', closeFn);
                    overlay.querySelector('.btn-cancel-edit').addEventListener('click', closeFn);

                    // click outside to close
                    overlay.addEventListener('click', (ev) => {
                        if (ev.target === overlay) closeFn();
                    });

                    overlay.querySelector('.btn-save-edit').addEventListener('click', async () => {
                        const newFullname = overlay.querySelector('#edit-user-fullname').value.trim();
                        const newPassword = overlay.querySelector('#edit-user-password').value;
                        const newIsAdmin = overlay.querySelector('#edit-user-isadmin').checked;

                        const updates = {
                            full_name: newFullname,
                            role: newIsAdmin ? 'admin' : 'user'
                        };
                        if (newPassword) updates.password = newPassword;

                        try {
                            const res = await apiFetch(`/api/admin/users/${id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(updates)
                            });
                            if (res.ok) {
                                window.showToast('사용자 정보가 수정되었습니다.', 'success');
                                closeFn();
                                loadAdminUsers(); // refresh the table
                            } else {
                                const err = await res.json();
                                window.showToast('수정 실패: ' + err.error, 'error');
                            }
                        } catch (e) {
                            console.error(e);
                            window.showToast('사용자 수정 중 오류가 발생했습니다.', 'error');
                        }
                    });
                });
            });

            // Attach delete handlers
            tbody.querySelectorAll('.btn-delete-user').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.target.dataset.id;
                    const ok = await window.showConfirm('이 사용자를 정말로 삭제하시겠습니까? 관련 채팅 기록도 모두 삭제됩니다.', '사용자 삭제', '삭제');
                    if (ok) {
                        try {
                            const dr = await apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
                            if (dr.ok) {
                                window.showToast('사용자가 삭제되었습니다.', 'success');
                                loadAdminUsers();
                            }
                            else {
                                const de = await dr.json();
                                window.showToast(`삭제 실패: ${de.error}`, 'error');
                            }
                        } catch (err) { console.error(err); window.showToast('삭제 오류 발생', 'error'); }
                    }
                });
            });
        } catch (err) { console.error('Failed to load users', err); }
    }

    let adminDocsData = [];
    let adminOrgsMap = {};
    let adminUsersMap = {};
    let adminCurrentFilter = { type: 'all', id: null }; // { type: 'all'|'org'|'user', id: string/number }

    async function loadAdminDocs() {
        try {
            const res = await apiFetch('/api/admin/documents');
            const userRes = await apiFetch('/api/admin/users');
            const orgRes = await apiFetch('/api/admin/organizations');
            if (!res.ok) return;

            const data = await res.json();
            adminDocsData = data.documents || [];

            adminUsersMap = {};
            if (userRes.ok) {
                const uData = await userRes.json();
                (uData.users || []).forEach(u => adminUsersMap[u.id] = u);
            }

            adminOrgsMap = {};
            if (orgRes.ok) {
                const oData = await orgRes.json();
                (oData.organizations || []).forEach(o => adminOrgsMap[o.id] = o);
            }

            renderAdminDocsTree();
            renderAdminDocsTable();

        } catch (err) { console.error('Failed to load admin docs', err); }
    }

    function getAdminOrgName(orgId) {
        if (!orgId) return '소속 없음';
        return adminOrgsMap[orgId] ? adminOrgsMap[orgId].name : `조직 #${orgId}`;
    }

    function getAdminUserName(userId) {
        if (!userId) return '알 수 없음';
        const u = adminUsersMap[userId];
        return u ? (u.full_name || u.username) : `사용자 #${userId}`;
    }

    function renderAdminDocsTree() {
        const treeContainer = document.getElementById('admin-doc-tree-list');
        if (!treeContainer) return;

        // 1. Build hierarchy from existing docs
        // Only include orgs and users that actually have documents
        const treeData = {}; // { orgId: { orgName, users: { userId: { userName, count } } } }
        let totalDocs = 0;

        adminDocsData.forEach(d => {
            totalDocs++;
            const orgId = d.organization_id || 'none';
            const userId = d.owner_id;

            if (!treeData[orgId]) {
                treeData[orgId] = {
                    name: getAdminOrgName(orgId),
                    users: {},
                    count: 0
                };
            }
            treeData[orgId].count++;

            if (!treeData[orgId].users[userId]) {
                treeData[orgId].users[userId] = {
                    name: getAdminUserName(userId),
                    count: 0
                };
            }
            treeData[orgId].users[userId].count++;
        });

        // 2. Render HTML
        let html = `
            <div class="folder-node all-docs-node ${adminCurrentFilter.type === 'all' ? 'active' : ''}" data-type="all">
                <span class="folder-icon">📁</span>
                <span class="folder-name">전체 문서</span>
                <span class="folder-count">${totalDocs}</span>
            </div>
        `;

        // Sort orgs by name
        const sortedOrgs = Object.keys(treeData).sort((a, b) => treeData[a].name.localeCompare(treeData[b].name));

        sortedOrgs.forEach(orgId => {
            const org = treeData[orgId];
            const isOrgActive = adminCurrentFilter.type === 'org' && adminCurrentFilter.id == orgId;
            // Always keep orgs open for now, or toggleable
            html += `
                <div class="folder-group" style="display: block; margin-bottom: 8px;">
                    <div class="folder-node org-summary ${isOrgActive ? 'active' : ''}" data-type="org" data-id="${orgId}" style="display: flex; cursor: pointer;">
                        <span class="folder-icon">🏢</span>
                        <span class="folder-name">${escapeHtml(org.name)}</span>
                        <span class="folder-count">${org.count}</span>
                    </div>
                    <div class="folder-children" style="margin-left: 16px; display: block; border-left: 1px solid rgba(255,255,255,0.1); padding-left: 6px;">
            `;

            // Sort users by name
            const sortedUsers = Object.keys(org.users).sort((a, b) => org.users[a].name.localeCompare(org.users[b].name));
            sortedUsers.forEach(userId => {
                const user = org.users[userId];
                const isUserActive = adminCurrentFilter.type === 'user' && adminCurrentFilter.id == userId;
                html += `
                    <div class="folder-node user-node ${isUserActive ? 'active' : ''}" data-type="user" data-id="${userId}" data-org="${orgId}">
                        <span class="folder-icon">👤</span>
                        <span class="folder-name">${escapeHtml(user.name)}</span>
                        <span class="folder-count">${user.count}</span>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        });

        treeContainer.innerHTML = html;

        // 3. Attach Events
        treeContainer.querySelectorAll('.all-docs-node').forEach(el => {
            el.addEventListener('click', (e) => {
                adminCurrentFilter = { type: 'all', id: null };
                document.getElementById('admin-current-folder-name').textContent = '전체 문서';
                renderAdminDocsTree(); // re-render to update active classes
                renderAdminDocsTable();
            });
        });

        treeContainer.querySelectorAll('.org-summary').forEach(el => {
            el.addEventListener('click', (e) => {
                adminCurrentFilter = { type: 'org', id: el.dataset.id };
                document.getElementById('admin-current-folder-name').textContent = treeData[el.dataset.id].name;
                renderAdminDocsTree();
                renderAdminDocsTable();
                e.preventDefault();
            });
        });

        treeContainer.querySelectorAll('.user-node').forEach(el => {
            el.addEventListener('click', (e) => {
                adminCurrentFilter = { type: 'user', id: el.dataset.id };
                const orgName = treeData[el.dataset.org].name;
                const userName = treeData[el.dataset.org].users[el.dataset.id].name;
                document.getElementById('admin-current-folder-name').textContent = `${orgName} > ${userName}`;
                renderAdminDocsTree();
                renderAdminDocsTable();
            });
        });
    }

    function renderAdminDocsTable() {
        const tbody = document.getElementById('admin-docs-list');
        if (!tbody) return;
        tbody.innerHTML = '';

        // Filter docs based on selection
        let filteredDocs = adminDocsData;
        if (adminCurrentFilter.type === 'org') {
            filteredDocs = adminDocsData.filter(d => (d.organization_id || 'none') == adminCurrentFilter.id);
        } else if (adminCurrentFilter.type === 'user') {
            filteredDocs = adminDocsData.filter(d => d.owner_id == adminCurrentFilter.id);
        }

        if (filteredDocs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--text-secondary);">해당 폴더에 문서가 없습니다.</td></tr>';
            return;
        }

        filteredDocs.forEach((d, index) => {
            const orgName = getAdminOrgName(d.organization_id);
            const userName = getAdminUserName(d.owner_id);
            const uploaderText = userName;
            const visStr = d.visibility === 'public' ? '전체 공개' : (d.visibility === 'organization' ? '조직 공용' : '비공개');
            const statusHtml = d.status === 'ready' ? '<span class="status-badge ready">준비됨</span>' : `<span class="status-badge processing">${d.status}</span>`;

            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid var(--border-color); hover:background: rgba(0,0,0,0.02);">
                    <td style="padding: 10px; color: var(--text-secondary);">${index + 1}</td>
                    <td style="padding: 10px; font-size: 0.9rem;">${escapeHtml(uploaderText)}</td>
                    <td style="padding: 10px; font-size: 0.9rem;">${escapeHtml(orgName)}</td>
                    <td style="padding: 10px; font-weight: 500; max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</td>
                    <td style="padding: 10px;">${statusHtml}</td>
                    <td style="padding: 10px; font-size: 0.85rem; color: var(--text-secondary);">${d.upload_date || '-'}</td>
                    <td style="padding: 10px; font-size: 0.9rem; text-align: right;">${d.page_count || '-'}</td>
                    <td style="padding: 10px;">
                        <div style="display:flex; gap:8px;">
                            <button class="btn-action btn-view view" data-doc="${d.id}">보기</button>
                            <button class="btn-action delete btn-admin-delete-doc" data-id="${d.id}">강제 삭제</button>
                        </div>
                    </td>
                </tr>
            `;
        });

        // Re-attach delete listeners
        tbody.querySelectorAll('.btn-admin-delete-doc').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const docId = e.target.dataset.id;
                const ok = await window.showConfirm(`이 문서(${docId})가 강제 삭제됩니다.\n업로더의 폴더가 비워지면 자동으로 폴더 목록에서도 사라집니다.\n계속하시겠습니까?`, '강제 삭제 확인', '강제 삭제');
                if (ok) {
                    try {
                        const dr = await apiFetch(`/api/documents/${docId}`, { method: 'DELETE' });
                        if (dr.ok) {
                            window.showToast('삭제 완료', 'success');
                            loadAdminDocs(); // Reloads data, which intrinsically rebuilds the tree (auto-deleting empty folders)
                            // refresh standard list too if manage tab is open
                            apiFetch('/api/documents').then(r => r.json()).then(resp => updateDocsList(resp));
                        }
                        else { const de = await dr.json(); window.showToast(`삭제 실패: ${de.error}`, 'error'); }
                    } catch (err) { console.error(err); }
                }
            });
        });
    }

    // ========================== AGENT MANAGEMENT =========================
    const agentsListContainer = document.getElementById('agents-list-container');
    const formAgentEditor = document.getElementById('form-agent-editor');
    const agentEditorContainer = document.getElementById('agent-editor-container');
    const agentEditorPlaceholder = document.getElementById('agent-editor-placeholder');
    const agentEditorTitle = document.getElementById('agent-editor-title');
    const btnCreateAgentNew = document.getElementById('btn-create-agent-new');
    const btnDeleteAgent = document.getElementById('btn-delete-agent');
    const btnCancelAgent = document.getElementById('btn-cancel-agent');
    const btnGenerateAgent = document.getElementById('btn-generate-agent');

    // Custom elements for Templates and Test Sandbox
    const btnTestAgent = document.getElementById('btn-test-agent');
    const agentTemplateFile = document.getElementById('agent-template-file');
    const btnSelectAgentTemplate = document.getElementById('btn-select-agent-template');
    const btnClearAgentTemplate = document.getElementById('btnClearAgentTemplate');
    const agentTemplateNameDisplay = document.getElementById('agent-template-name-display');
    const agentTestOutputContainer = document.getElementById('agent-test-output-container');
    const agentTestOutputLogs = document.getElementById('agent-test-output-logs');
    const agentTestOutputFiles = document.getElementById('agent-test-output-files');

    // Testing specific vars
    const agentTestFiles = document.getElementById('agent-test-files');
    const btnSelectTestFiles = document.getElementById('btn-select-test-files');
    const btnClearTestFiles = document.getElementById('btn-clear-test-files');
    const agentTestFilesDisplay = document.getElementById('agent-test-files-display');
    const agentTestArgs = document.getElementById('agent-test-args');

    let currentAgents = [];
    let activeAgentId = null;

    window.loadAgentList = async function () {
        if (!agentsListContainer) return;
        try {
            const res = await apiFetch('/api/agents');
            const data = await res.json();
            currentAgents = data.agents || [];

            // Render list
            agentsListContainer.innerHTML = '';

            if (currentAgents.length === 0) {
                agentsListContainer.innerHTML = '<div style="padding: 10px; color: var(--text-secondary); text-align:center; font-size: 0.85rem;">해당 요소가 없습니다.</div>';
            } else {
                currentAgents.forEach(agent => {
                    const el = document.createElement('div');
                    el.className = `folder-node ${activeAgentId == agent.id ? 'active' : ''}`;
                    el.style.cursor = 'pointer';

                    let badgeColor = agent.share_scope === 'ALL' ? 'var(--primary)' : (agent.share_scope === 'ORG' ? 'var(--warning-color)' : 'var(--text-secondary)');
                    let badgeText = agent.share_scope === 'ALL' ? '전체' : (agent.share_scope === 'ORG' ? '조직' : '개인');

                    if (agent.share_scope && agent.share_scope.startsWith('group_')) {
                        badgeColor = 'var(--text-primary)';
                        badgeText = '공유 그룹';
                    }

                    let sharedBadge = (currentUser && agent.user_id !== currentUser.id) ? `<span style="font-size:0.7rem; padding: 2px 6px; border-radius: 4px; background: rgba(0,0,0,0.05); color: var(--warning-color); border: 1px solid var(--warning-color)33; margin-right:4px;">공유받음</span>` : '';

                    let icon = '💭';
                    let borderLeft = '4px solid var(--accent)';

                    if (borderLeft) el.style.borderLeft = borderLeft;

                    let typeBadge = `<span style="font-size:0.7rem; padding: 2px 6px; border-radius: 4px; background: rgba(0,0,0,0.05); color: var(--accent); border: 1px solid var(--accent)33;">자율형</span>`;

                    el.innerHTML = `
                        <span class="folder-icon">${icon}</span>
                        <div style="flex:1; min-width:0; overflow:hidden;">
                            <div class="folder-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(agent.name)}</div>
                            <div style="font-size:0.75rem; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(agent.description || '')}</div>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end;">
                            <div style="display:flex; gap:4px; align-items:center;">${sharedBadge}${typeBadge}</div>
                            <span style="font-size:0.7rem; padding: 2px 6px; border-radius: 4px; background: rgba(0,0,0,0.05); color: ${badgeColor}; border: 1px solid ${badgeColor}33;">${badgeText}</span>
                        </div>
                    `;
                    el.addEventListener('click', () => editAgent(agent));
                    agentsListContainer.appendChild(el);
                });
            }
        } catch (e) {
            console.error("Failed to load agents", e);
        }
    };

    window.loadAgentsForChat = async function () {
        const chatAgentFilter = document.getElementById('chat-agent-filter');
        if (!chatAgentFilter) return;
        try {
            const res = await apiFetch('/api/agents');
            const data = await res.json();

            const currentSelectedValue = chatAgentFilter.value;

            // Preserve the original RAG options
            chatAgentFilter.innerHTML = '<option value="">🎯 RAG 기본 질의 (문서 기반)</option>';
            const agents = data.agents || [];
            agents.forEach(agent => {
                const opt = document.createElement('option');
                opt.value = agent.id;
                // Add star indicator if it processes files
                opt.textContent = `🤖 ${agent.name} ${agent.requires_file_upload ? '(파일 지원)' : ''}`;
                let isCodeEnabled = true;
                let isRagActive = true;
                try {
                    const cfg = JSON.parse(agent.config || '{}');
                    if (cfg.code_enabled === false) isCodeEnabled = false;
                    // Unified schema uses long_memory, legacy uses rag_active
                    if (cfg.long_memory === false || cfg.rag_active === false) isRagActive = false;
                } catch (e) { }

                if (agent.python_code && agent.python_code.trim()) {
                    opt.dataset.hasCode = 'true';
                    opt.dataset.codeEnabled = isCodeEnabled;
                }

                if (agent.requires_file_upload) {
                    opt.dataset.reqFile = 'true';
                }

                opt.dataset.ragActive = isRagActive;

                chatAgentFilter.appendChild(opt);
            });


            // Restore previous selection if it still exists
            if (currentSelectedValue && chatAgentFilter.querySelector(`option[value="${currentSelectedValue}"]`)) {
                chatAgentFilter.value = currentSelectedValue;
            }

            // Re-trigger visual checks if an agent was already selected
            chatAgentFilter.dispatchEvent(new Event('change'));
        } catch (e) { console.error("Failed to load agents for chat", e); }
    };

    const chatAgentFilterEl = document.getElementById('chat-agent-filter');
    if (chatAgentFilterEl) {
        chatAgentFilterEl.addEventListener('change', () => {
            const selectedOpt = chatAgentFilterEl.options[chatAgentFilterEl.selectedIndex];
            const toggleContainer = document.getElementById('chat-sandbox-toggle-container');
            const sandboxCheckbox = document.getElementById('chat-run-sandbox');
            const btnAttachFile = document.getElementById('btn-attach-file');

            if (toggleContainer) {
                // UI에서 더 이상 코드 활성 체크박스를 보여주지 않습니다. (사용자 요청)
                toggleContainer.classList.add('hidden');

                if (selectedOpt && selectedOpt.dataset.hasCode === 'true') {
                    if (sandboxCheckbox) {
                        sandboxCheckbox.checked = selectedOpt.dataset.codeEnabled === 'true';
                    }
                } else {
                    if (sandboxCheckbox) {
                        sandboxCheckbox.checked = false;
                    }
                }
            }

            const searchModeContainer = document.getElementById('chat-search-mode-container');
            const searchModeCheckbox = document.getElementById('chat-search-mode');
            const btnSelectDocs = document.getElementById('btn-select-docs');
            if (searchModeContainer) {
                if (!selectedOpt.value || selectedOpt.dataset.ragActive === 'true') {
                    searchModeContainer.style.display = 'flex';
                    if (btnSelectDocs) btnSelectDocs.style.display = '';
                } else {
                    searchModeContainer.style.display = 'none';
                    if (searchModeCheckbox) searchModeCheckbox.checked = false;
                    if (btnSelectDocs) btnSelectDocs.style.display = 'none';
                }
            }

            if (btnAttachFile) {
                if (selectedOpt && selectedOpt.dataset.reqFile === 'true') {
                    btnAttachFile.classList.remove('hidden');
                } else {
                    btnAttachFile.classList.add('hidden');
                    // 에이전트 변경으로 인해 첨부 버튼이 비활성화될 때, 이미 첨부된 파일이 있다면 지우기
                    const btnRemoveAttachment = document.getElementById('btn-remove-attachment');
                    if (btnRemoveAttachment) {
                        btnRemoveAttachment.click();
                    }
                }
            }
        });
    }

    const agentTypeRadios = document.querySelectorAll('input[name="agent-type"]');
    function updateAgentConfigVisibility(type, configObj = null) {
        // Calculate daemon state
        let isDaemon = document.getElementById('cfg-auto-daemon')?.checked;
        if (configObj && configObj['cfg-auto-daemon'] !== undefined) {
            isDaemon = configObj['cfg-auto-daemon'];
        }

        // Disable test execution button if is daemon
        const btnTestAgent = document.getElementById('btn-test-agent');
        if (btnTestAgent) {
            if (isDaemon) {
                btnTestAgent.disabled = true;
                btnTestAgent.title = '상시 동작(데몬) 모드에서는 코드 미리 실행을 사용할 수 없으며, 데몬 제어판을 이용해야 합니다.';
                btnTestAgent.style.opacity = '0.5';
                btnTestAgent.style.cursor = 'not-allowed';
            } else {
                btnTestAgent.disabled = false;
                btnTestAgent.title = '';
                btnTestAgent.style.opacity = '1';
                btnTestAgent.style.cursor = 'pointer';
            }
        }

        // Show daemon control panel if active agent is autonomous daemon
        const daemonPanel = document.getElementById('daemon-control-panel');
        if (daemonPanel) {
            if (activeAgentId && isDaemon) {
                daemonPanel.style.display = 'block';
                if (window._refreshDaemonLogs) window._refreshDaemonLogs();
            } else {
                daemonPanel.style.display = 'none';
            }
        }
    }

    const agentCodeActiveField = document.getElementById('agent-code-active-field');
    if (agentCodeActiveField) {
        agentCodeActiveField.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const codeField = document.getElementById('agent-code-field');
            if (codeField) {
                codeField.style.opacity = isChecked ? '1' : '0.4';
                codeField.disabled = !isChecked;
            }

            const reqFileField = document.getElementById('agent-req-file-field');
            if (reqFileField) {
                if (!isChecked) reqFileField.checked = false;
                reqFileField.disabled = !isChecked;
                reqFileField.parentElement.style.opacity = isChecked ? '1' : '0.5';
                reqFileField.parentElement.style.cursor = isChecked ? 'pointer' : 'not-allowed';
            }

            const reqPromptField = document.getElementById('agent-req-prompt-field');
            if (reqPromptField) {
                if (!isChecked) reqPromptField.checked = false;
                reqPromptField.disabled = !isChecked;
                reqPromptField.parentElement.style.opacity = isChecked ? '1' : '0.5';
                reqPromptField.parentElement.style.cursor = isChecked ? 'pointer' : 'not-allowed';
            }
        });
    }

    const _reqFileField = document.getElementById('agent-req-file-field');
    const _reqPromptField = document.getElementById('agent-req-prompt-field');
    const _codeField = document.getElementById('agent-code-field');

    async function handleCheckboxAIUpdate(e) {
        if (!_codeField || !_codeField.value.trim()) {
            if (e.target.checked) {
                if (e.target.id === 'agent-req-file-field') {
                    _codeField.value = 'import sys\nif len(sys.argv) > 1:\n    file_path = sys.argv[1]\n    print(f"첨부파일 경로: {file_path}")\n\n';
                } else if (e.target.id === 'agent-req-prompt-field') {
                    _codeField.value = 'import os\nimport sys\nuser_question = os.environ.get("AGENT_USER_PROMPT", "")\nif not user_question.strip():\n    print("사용자 질문이 없습니다.")\n    sys.exit(1)\nprint(f"사용자 질문 수신 완료: {user_question}")\n\n';
                }
            }
            return;
        }

        const origColor = e.target.parentElement.style.color;
        e.target.parentElement.style.color = 'var(--accent)';
        e.target.disabled = true;

        try {
            window.showToast("기존 코드를 분석하여 변경된 옵션을 자동 반영합니다...", "info");
            const formData = new FormData();
            formData.append('original_code', _codeField.value.trim());

            let modPrompt = e.target.checked
                ? "설정 필수 반영 규칙을 기존 비즈니스 로직에 결합해주세요."
                : (e.target.id === 'agent-req-file-field' ? "파이썬 스크립트에서 첨부파일 경로(sys.argv[1])를 파싱하는 로직을 제거해줘." : "파이썬 스크립트에서 AGENT_USER_PROMPT 환경변수를 읽어오는 로직을 제거해줘.");

            formData.append('modification_prompt', modPrompt);
            formData.append('requires_user_prompt', document.getElementById('agent-req-prompt-field').checked);
            formData.append('requires_file_upload', document.getElementById('agent-req-file-field').checked);

            const res = await apiFetch('/api/agents/modify_code', { method: 'POST', body: formData });
            if (res.ok) {
                const data = await res.json();
                if (data.python_code) _codeField.value = data.python_code;
                window.showToast("옵션 설정 변경에 따른 코드 자동 병합 완료!", "success");
            } else {
                const err = await res.json();
                window.showToast("코드 병합 실패: " + err.error, "error");
            }
        } catch (err) {
            console.error(err);
        } finally {
            e.target.disabled = false;
            e.target.parentElement.style.color = origColor;
        }
    }

    if (_reqFileField) _reqFileField.addEventListener('change', handleCheckboxAIUpdate);
    if (_reqPromptField) _reqPromptField.addEventListener('change', handleCheckboxAIUpdate);

    const btnModifyCode = document.getElementById('btn-modify-code');
    const inputCodeModifier = document.getElementById('agent-code-modifier-prompt');
    if (btnModifyCode && inputCodeModifier) {
        btnModifyCode.addEventListener('click', async () => {
            const currentCode = (_codeField) ? _codeField.value.trim() : '';
            const modPrompt = inputCodeModifier.value.trim();
            if (!currentCode) return window.showToast("수정할 기존 코드가 없습니다.", "error");
            if (!modPrompt) return window.showToast("코드 수정 요청사항을 입력해주세요.", "error");

            const origHTML = btnModifyCode.innerHTML;
            btnModifyCode.disabled = true;
            btnModifyCode.innerHTML = `<span style="display:inline-flex; align-items:center; gap:6px;">
                <svg style="animation: agent-spin 1s linear infinite;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg> 생성 중...</span>`;

            try {
                const formData = new FormData();
                formData.append('original_code', currentCode);
                formData.append('modification_prompt', modPrompt);
                formData.append('requires_user_prompt', document.getElementById('agent-req-prompt-field')?.checked || false);
                formData.append('requires_file_upload', document.getElementById('agent-req-file-field')?.checked || false);

                const res = await apiFetch('/api/agents/modify_code', { method: 'POST', body: formData });
                if (res.ok) {
                    const data = await res.json();
                    if (data.python_code) {
                        _codeField.value = data.python_code;
                        inputCodeModifier.value = '';
                        window.showToast("요청하신 내용으로 코드가 수정되었습니다.", "success");
                    }
                } else {
                    const err = await res.json();
                    window.showToast(`오류: ${err.error}`, "error");
                }
            } catch (err) {
                console.error(err);
            } finally {
                btnModifyCode.innerHTML = origHTML;
                btnModifyCode.disabled = false;
            }
        });
    }
    if (agentTypeRadios) {
        agentTypeRadios.forEach(r => {
            r.addEventListener('change', (e) => {
                if (e.target.checked) updateAgentConfigVisibility(e.target.value);
            });
        });
    }

    function deserializeAgentConfig(type, configString) {
        let cfg = {};
        try { cfg = JSON.parse(configString || '{}'); } catch (e) { }

        const setValue = (id, val) => { const el = document.getElementById(id); if (el) { if (el.type === 'checkbox') el.checked = val; else el.value = val; } };

        // Common Settings
        setValue('agent-code-active-field', cfg.code_enabled !== false);
        setValue('agent-req-prompt-field', !!cfg.requires_user_prompt);

        // Autonomous Settings
        setValue('cfg-auto-strategy', cfg.planning || 'react');
        setValue('cfg-auto-limit', cfg.max_iterations || 15);
        setValue('cfg-auto-memory', cfg.short_memory !== false);
        setValue('cfg-auto-hitl', !!cfg.hitl);
        setValue('cfg-auto-daemon', !!cfg['cfg-auto-daemon']);

        // Backward compatibility for legacy RAG settings -> map to cfg-auto-rag (장기 메모리 연동)
        if (type === 'RAG') {
            setValue('cfg-auto-rag', cfg.rag_active !== false);
        } else {
            setValue('cfg-auto-rag', !!cfg.long_memory);
        }
    }

    function serializeAgentConfig() {
        let cfg = {};
        const getValue = (id) => { const el = document.getElementById(id); return el ? (el.type === 'checkbox' ? el.checked : el.value) : null; };

        cfg.code_enabled = getValue('agent-code-active-field');
        cfg.requires_user_prompt = getValue('agent-req-prompt-field');

        cfg.planning = getValue('cfg-auto-strategy');
        cfg.max_iterations = parseInt(getValue('cfg-auto-limit')) || 15;
        cfg.short_memory = getValue('cfg-auto-memory');
        cfg.long_memory = getValue('cfg-auto-rag');
        cfg.hitl = getValue('cfg-auto-hitl');
        cfg['cfg-auto-daemon'] = getValue('cfg-auto-daemon');

        return JSON.stringify(cfg);
    }

    function editAgent(agent) {
        activeAgentId = agent.id;
        window.loadAgentList(); // re-render list to show active

        const btnTestAgent = document.getElementById('btn-test-agent');
        if (btnTestAgent) {
            btnTestAgent.innerText = '코드 미리 실행';
            btnTestAgent.disabled = false;
        }

        if (agentEditorPlaceholder) agentEditorPlaceholder.style.display = 'none';
        if (agentEditorContainer) agentEditorContainer.style.display = 'block';
        if (agentEditorTitle) agentEditorTitle.textContent = '에이전트 수정';

        document.getElementById('agent-id-field').value = agent.id;
        document.getElementById('agent-share-field').value = agent.share_scope || 'PRIVATE';
        document.getElementById('agent-name-field').value = agent.name;
        document.getElementById('agent-desc-field').value = agent.description || '';
        document.getElementById('agent-prompt-field').value = agent.system_prompt;
        document.getElementById('agent-code-field').value = agent.python_code || '';
        if (window.updateCodeLineNumbers) window.updateCodeLineNumbers();
        document.getElementById('agent-req-file-field').checked = agent.requires_file_upload;
        document.getElementById('agent-share-field').value = agent.share_scope;

        const aType = 'AUTONOMOUS';
        document.querySelectorAll('input[name="agent-type"]').forEach(r => r.checked = (r.value === aType));

        let cfgObj = {};
        try { cfgObj = JSON.parse(agent.config || '{}'); } catch (e) { }
        updateAgentConfigVisibility(aType, cfgObj);
        deserializeAgentConfig(agent.agent_type || 'RAG', agent.config);

        // Trigger visual opacity refresh
        const codeActiveEl = document.getElementById('agent-code-active-field');
        if (codeActiveEl) codeActiveEl.dispatchEvent(new Event('change'));

        const iaf = document.getElementById('cfg-auto-daemon');
        if (iaf && agent.is_active) iaf.checked = true;

        if (agentTemplateFile) agentTemplateFile.value = '';
        if (agentTemplateNameDisplay) {
            if (agent.template_filename) {
                agentTemplateNameDisplay.textContent = `[저장됨] ${agent.template_filename}`;
                agentTemplateNameDisplay.style.color = 'var(--primary)';
            } else {
                agentTemplateNameDisplay.textContent = '선택된 파일 없음';
                agentTemplateNameDisplay.style.color = 'var(--text-secondary)';
            }
        }
        if (btnClearAgentTemplate) btnClearAgentTemplate.classList.add('hidden');
        if (agentTestOutputContainer) agentTestOutputContainer.classList.add('hidden');

        // Show delete button only if owner or admin
        // Disable editing for shared agents
        const isShared = (currentUser && agent.user_id !== currentUser.id && currentUser.role !== 'admin');
        ['agent-name-field', 'agent-desc-field', 'agent-prompt-field', 'agent-code-field'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.readOnly = isShared;
        });
        ['agent-share-field', 'agent-req-file-field', 'cfg-auto-daemon'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = isShared;
        });
        const btnSave = document.getElementById('btn-save-agent');
        if (btnSave) btnSave.style.display = isShared ? 'none' : 'block';
        if (agentEditorTitle) {
            agentEditorTitle.textContent = isShared ? '에이전트 정보 (공유받음 - 보기 전용)' : '에이전트 수정';
        }

        // Show delete and reset buttons only if owner or admin
        const btnResetSandbox = document.getElementById('btn-reset-sandbox');
        if (btnDeleteAgent) {
            if (currentUser.role === 'admin' || currentUser.id === agent.user_id) {
                btnDeleteAgent.style.display = 'block';
                if (btnResetSandbox) btnResetSandbox.style.display = 'block';
            } else {
                btnDeleteAgent.style.display = 'none';
                if (btnResetSandbox) btnResetSandbox.style.display = 'none';
            }
        }
    }

    if (btnCreateAgentNew) {
        btnCreateAgentNew.addEventListener('click', () => {
            activeAgentId = null;
            window.loadAgentList();

            ['agent-name-field', 'agent-desc-field', 'agent-prompt-field', 'agent-code-field'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.readOnly = false;
            });
            ['agent-share-field', 'agent-req-file-field', 'cfg-auto-daemon'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.disabled = false;
            });
            const btnSave = document.getElementById('btn-save-agent');
            if (btnSave) btnSave.style.display = 'block';

            const btnTestAgent = document.getElementById('btn-test-agent');
            if (btnTestAgent) {
                btnTestAgent.innerText = '코드 미리 실행';
                btnTestAgent.disabled = false;
            }

            if (agentEditorPlaceholder) agentEditorPlaceholder.style.display = 'none';
            if (agentEditorContainer) agentEditorContainer.style.display = 'block';
            if (agentEditorTitle) agentEditorTitle.textContent = '새 에이전트 생성';

            if (formAgentEditor) formAgentEditor.reset();
            document.getElementById('agent-id-field').value = '';
            document.getElementById('agent-share-field').value = 'PRIVATE';
            document.getElementById('agent-share-field').value = 'PRIVATE';
            document.getElementById('agent-gen-requirements').value = '';

            const autoRadio = document.querySelector('input[name="agent-type"][value="AUTONOMOUS"]');
            if (autoRadio) autoRadio.checked = true;
            updateAgentConfigVisibility('AUTONOMOUS');
            deserializeAgentConfig('AUTONOMOUS', '{}');

            const activeField = document.getElementById('cfg-auto-daemon');
            if (activeField) activeField.checked = false;

            // Trigger visual opacity refresh
            const codeActiveEl = document.getElementById('agent-code-active-field');
            if (codeActiveEl) codeActiveEl.dispatchEvent(new Event('change'));

            if (agentTemplateFile) agentTemplateFile.value = '';
            if (agentTemplateNameDisplay) {
                agentTemplateNameDisplay.textContent = '선택된 파일 없음';
                agentTemplateNameDisplay.style.color = 'var(--text-secondary)';
            }
            if (btnClearAgentTemplate) btnClearAgentTemplate.classList.add('hidden');
            if (agentTestOutputContainer) agentTestOutputContainer.classList.add('hidden');

            if (btnDeleteAgent) btnDeleteAgent.style.display = 'none';
            const btnResetSandbox = document.getElementById('btn-reset-sandbox');
            if (btnResetSandbox) btnResetSandbox.style.display = 'none';
        });
    }

    if (btnCancelAgent) {
        btnCancelAgent.addEventListener('click', () => {
            activeAgentId = null;
            window.loadAgentList();
            if (agentEditorContainer) agentEditorContainer.style.display = 'none';
            if (agentEditorPlaceholder) agentEditorPlaceholder.style.display = 'flex';
        });
    }

    if (btnSelectAgentTemplate) {
        btnSelectAgentTemplate.addEventListener('click', () => {
            if (agentTemplateFile) agentTemplateFile.click();
        });
    }
    if (agentTemplateFile) {
        agentTemplateFile.addEventListener('change', () => {
            if (agentTemplateFile.files.length > 0) {
                agentTemplateNameDisplay.textContent = agentTemplateFile.files[0].name;
                agentTemplateNameDisplay.style.color = 'var(--text-primary)';
                btnClearAgentTemplate.classList.remove('hidden');

                const reqField = document.getElementById('agent-gen-requirements');
                if (reqField && !reqField.value.trim()) {
                    reqField.value = '이 문서 빈칸을 내 대화 내용으로 채우는 에이전트 생성해 줘';
                }
            } else {
                agentTemplateNameDisplay.textContent = '선택된 파일 없음';
                agentTemplateNameDisplay.style.color = 'var(--text-secondary)';
                btnClearAgentTemplate.classList.add('hidden');
            }
        });
    }
    if (btnClearAgentTemplate) {
        btnClearAgentTemplate.addEventListener('click', () => {
            agentTemplateFile.value = '';
            agentTemplateNameDisplay.textContent = '선택된 파일 없음 (기존 템플릿도 삭제됩니다)';
            agentTemplateNameDisplay.style.color = 'var(--danger)';
            btnClearAgentTemplate.classList.add('hidden');
        });
    }

    if (btnSelectTestFiles) {
        btnSelectTestFiles.addEventListener('click', () => {
            if (agentTestFiles) agentTestFiles.click();
        });
    }
    if (agentTestFiles) {
        agentTestFiles.addEventListener('change', () => {
            if (agentTestFiles.files.length > 0) {
                const names = Array.from(agentTestFiles.files).map(f => f.name).join(', ');
                agentTestFilesDisplay.textContent = names.length > 50 ? names.substring(0, 47) + '...' : names;
                agentTestFilesDisplay.style.color = 'var(--text-primary)';
                btnClearTestFiles.classList.remove('hidden');
            } else {
                agentTestFilesDisplay.textContent = '선택된 파일 없음';
                agentTestFilesDisplay.style.color = 'var(--text-secondary)';
                btnClearTestFiles.classList.add('hidden');
            }
        });
    }
    if (btnClearTestFiles) {
        btnClearTestFiles.addEventListener('click', () => {
            agentTestFiles.value = '';
            agentTestFilesDisplay.textContent = '선택된 파일 없음';
            agentTestFilesDisplay.style.color = 'var(--text-secondary)';
            btnClearTestFiles.classList.add('hidden');
        });
    };

    if (formAgentEditor) {
        formAgentEditor.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('agent-id-field').value;
            const agentType = 'AUTONOMOUS';

            const payload = {
                name: document.getElementById('agent-name-field').value,
                description: document.getElementById('agent-desc-field').value,
                system_prompt: document.getElementById('agent-prompt-field').value,
                python_code: document.getElementById('agent-code-field').value,
                requires_file_upload: document.getElementById('agent-req-file-field').checked,
                share_scope: document.getElementById('agent-share-field').value,
                agent_type: agentType,
                config: serializeAgentConfig(),
                is_active: document.getElementById('cfg-auto-daemon')?.checked || false
            };

            // If the user explicitly clicked X and cleared the state
            if (agentTemplateFile && agentTemplateFile.files.length === 0 && agentTemplateNameDisplay && agentTemplateNameDisplay.textContent.includes('삭제됩니다')) {
                payload.template_filename = null;
            }

            try {
                const method = id ? 'PUT' : 'POST';
                const url = id ? `/api/agents/${id}` : '/api/agents';

                const res = await apiFetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (res.ok) {
                    const savedData = await res.json();
                    const newAgentId = id || savedData.id;

                    // Proceed to upload the template file if selected
                    if (agentTemplateFile && agentTemplateFile.files.length > 0) {
                        const formData = new FormData();
                        formData.append('template_file', agentTemplateFile.files[0]);
                        await apiFetch(`/api/agents/${newAgentId}/template`, {
                            method: 'POST',
                            body: formData
                        });
                    }

                    window.showToast(id ? '에이전트가 수정되었습니다.' : '에이전트가 생성되었습니다.', 'success');
                    window.loadAgentList();
                    if (!id) {
                        agentEditorContainer.style.display = 'none';
                        agentEditorPlaceholder.style.display = 'flex';
                    }
                } else {
                    const err = await res.json();
                    window.showToast(`오류: ${err.error}`, 'error');
                }
            } catch (e) { console.error(e); }
        });
    }

    if (btnDeleteAgent) {
        btnDeleteAgent.addEventListener('click', async () => {
            const id = document.getElementById('agent-id-field').value;
            if (!id) return;

            if (await window.showConfirm('정말 이 에이전트를 삭제하시겠습니까?', '에이전트 삭제', '삭제')) {
                try {
                    const res = await apiFetch(`/api/agents/${id}`, { method: 'DELETE' });
                    if (res.ok) {
                        window.showToast('삭제되었습니다.', 'success');
                        activeAgentId = null;
                        if (agentEditorContainer) agentEditorContainer.style.display = 'none';
                        if (agentEditorPlaceholder) agentEditorPlaceholder.style.display = 'flex';
                        window.loadAgentList();
                    } else {
                        const err = await res.json();
                        window.showToast(`삭제 실패: ${err.error}`, 'error');
                    }
                } catch (e) { console.error(e); }
            }
        });
    }

    const btnResetSandbox = document.getElementById('btn-reset-sandbox');
    if (btnResetSandbox) {
        btnResetSandbox.addEventListener('click', async () => {
            const id = document.getElementById('agent-id-field').value;
            if (!id) return;

            if (await window.showConfirm('샌드박스 가상환경 시스템 데이터를 삭제하시겠습니까?\n이후 첫 실행 시 패키지 의존성 재설치 시간이 소요될 수 있습니다.', '샌드박스 초기화', '초기화')) {
                try {
                    const res = await apiFetch(`/api/agents/${id}/sandbox/reset`, { method: 'POST' });
                    const data = await res.json();
                    if (res.ok) {
                        window.showToast(data.message || '가상환경 데이터가 초기화되었습니다.', 'success');
                    } else {
                        window.showToast(`초기화 실패: ${data.error}`, 'error');
                    }
                } catch (e) {
                    window.showToast('통신 오류가 발생했습니다.', 'error');
                    console.error(e);
                }
            }
        });
    }

    if (btnTestAgent) {
        btnTestAgent.addEventListener('click', async () => {
            const pythonCode = document.getElementById('agent-code-field').value;
            if (!pythonCode.trim()) {
                window.showToast('테스트할 파이썬 코드를 작성해주세요.', 'error');
                return;
            }

            const origText = btnTestAgent.innerText;
            btnTestAgent.innerText = '실행 중...';
            btnTestAgent.disabled = true;
            const btnCancelTestAgent = document.getElementById('btn-cancel-test-agent');
            if (btnCancelTestAgent) btnCancelTestAgent.classList.remove('hidden');
            if (agentTestOutputContainer) {
                agentTestOutputContainer.classList.remove('hidden');
                setTimeout(() => agentTestOutputContainer.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
            }
            if (agentTestOutputLogs) agentTestOutputLogs.textContent = '생성된 Sandbox 런타임에서 실행 중입니다...\n-------------------------------------------------\n\n';
            if (agentTestOutputFiles) agentTestOutputFiles.innerHTML = '';

            try {
                const formData = new FormData();
                formData.append('python_code', pythonCode);
                if (agentTemplateFile && agentTemplateFile.files.length > 0) {
                    formData.append('template_file', agentTemplateFile.files[0]);
                }
                if (activeAgentId) {
                    formData.append('agent_id', activeAgentId);
                }

                const testArgsEl = document.getElementById('agent-test-args');
                if (testArgsEl && testArgsEl.value.trim()) {
                    formData.append('test_args', testArgsEl.value.trim());
                }

                const testFilesEl = document.getElementById('agent-test-files');
                if (testFilesEl && testFilesEl.files.length > 0) {
                    Array.from(testFilesEl.files).forEach(file => {
                        formData.append('test_files', file);
                    });
                }

                const res = await apiFetch('/api/agents/test', {
                    method: 'POST',
                    body: formData
                });

                const data = await res.json();

                if (!res.ok) {
                    if (data.detail && Array.isArray(data.detail)) {
                        const errMsgs = data.detail.map(e => `${e.loc.join('.')}: ${e.msg}`).join('\n');
                        if (agentTestOutputLogs) agentTestOutputLogs.textContent += '[서버 입력 형식 오류 (422)]\n' + errMsgs;
                    } else {
                        if (agentTestOutputLogs) agentTestOutputLogs.textContent += '[서버 오류] ' + (data.error || '알 수 없는 오류 발생');
                    }
                } else {
                    if (data.auto_fixed_code) {
                        const codeField = document.getElementById('agent-code-field');
                        if (codeField) codeField.value = data.auto_fixed_code;
                        window.showToast('⚠️ AI가 실행 오류를 자동 감지하고 코드를 수정했습니다!', 'success');
                    }
                    if (agentTestOutputLogs) {
                        agentTestOutputLogs.textContent += '[STDOUT]\n' + (data.stdout || '(출력 없음)\n');
                        agentTestOutputLogs.textContent += '\n[STDERR]\n' + (data.stderr || '(오류 없음)\n');
                    }

                    if (data.output_files && data.output_files.length > 0 && agentTestOutputFiles) {
                        agentTestOutputFiles.innerHTML = '<strong>[생성된 파일]</strong><br>';
                        data.output_files.forEach(f => {
                            agentTestOutputFiles.innerHTML += `<a href="${f.url}" target="_blank" style="display:inline-block; margin-right:8px; margin-top:4px; padding:4px 8px; background:var(--primary); color:#fff; text-decoration:none; border-radius:4px;">${f.filename} 다운로드</a>`;
                        });
                    }
                }
            } catch (e) {
                if (agentTestOutputLogs) agentTestOutputLogs.textContent += '[네트워크 오류] ' + String(e);
            } finally {
                if (agentTestOutputContainer) {
                    setTimeout(() => agentTestOutputContainer.scrollIntoView({ behavior: 'smooth', block: 'end' }), 100);
                }
                const btnCancelTestAgent = document.getElementById('btn-cancel-test-agent');
                if (btnCancelTestAgent) btnCancelTestAgent.classList.add('hidden');
                btnTestAgent.innerText = '코드 미리 실행';
                btnTestAgent.disabled = false;
            }
        });
    }

    const btnRunManualCommand = document.getElementById('btn-run-manual-command');
    const inputManualCommand = document.getElementById('agent-manual-command');

    if (inputManualCommand && btnRunManualCommand) {
        inputManualCommand.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // 하드포크 방지, 저장(Save) 버튼 트리거 회피
                btnRunManualCommand.click();
            }
        });
    }

    if (btnRunManualCommand) {
        btnRunManualCommand.addEventListener('click', async () => {
            if (!activeAgentId) {
                window.showToast('먼저 좌측에서 에이전트를 선택하거나 저장해주세요.', 'error');
                return;
            }
            const cmdInput = document.getElementById('agent-manual-command');
            const command = cmdInput ? cmdInput.value.trim() : '';
            if (!command) {
                window.showToast('실행할 명령어를 입력하세요.', 'error');
                return;
            }
            if (cmdInput) cmdInput.value = '';

            if (agentTestOutputContainer) agentTestOutputContainer.classList.remove('hidden');
            if (agentTestOutputLogs) agentTestOutputLogs.textContent = `[수동 터미널 실행] > ${command}\n-------------------------------------------------\n\n실행 중입니다. 잠시만 기다려주세요...\n`;
            if (agentTestOutputFiles) agentTestOutputFiles.innerHTML = '';

            btnRunManualCommand.disabled = true;
            btnRunManualCommand.innerText = '실행 중...';
            const btnCancelManualCommand = document.getElementById('btn-cancel-manual-command');
            if (btnCancelManualCommand) btnCancelManualCommand.classList.remove('hidden');

            try {
                const res = await apiFetch(`/api/agents/${activeAgentId}/sandbox/terminal`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: command })
                });

                const data = await res.json();

                if (agentTestOutputLogs) {
                    agentTestOutputLogs.textContent = `[수동 터미널 실행] > ${command}\n-------------------------------------------------\n`;
                    if (!res.ok) {
                        agentTestOutputLogs.textContent += '[서버 오류] ' + (data.error || '알 수 없는 오류 발생\n');
                    } else {
                        if (data.stdout) {
                            agentTestOutputLogs.textContent += '[STDOUT]\n' + data.stdout + '\n';
                        }
                        if (data.stderr) {
                            agentTestOutputLogs.textContent += '[STDERR]\n' + data.stderr + '\n';
                        }
                        if (!data.stdout && !data.stderr) {
                            agentTestOutputLogs.textContent += '(출력 없음)\n';
                        }
                    }
                }
            } catch (e) {
                if (agentTestOutputLogs) agentTestOutputLogs.textContent += '\n[네트워크 오류] ' + String(e);
            } finally {
                const btnCancelManualCommand = document.getElementById('btn-cancel-manual-command');
                if (btnCancelManualCommand) btnCancelManualCommand.classList.add('hidden');
                btnRunManualCommand.innerText = '터미널 실행';
                btnRunManualCommand.disabled = false;
                if (agentTestOutputContainer) {
                    setTimeout(() => agentTestOutputContainer.scrollIntoView({ behavior: 'smooth', block: 'end' }), 100);
                }
            }
        });
    }

    const handleCancelSandbox = async () => {
        if (!activeAgentId) return;
        try {
            const res = await apiFetch(`/api/agents/${activeAgentId}/sandbox/cancel`, { method: 'POST' });
            if (!res.ok) {
                const data = await res.json();
                window.showToast(`취소 실패: ${data.error || '알 수 없는 오류'}`, 'alert');
            } else {
                window.showToast('강제 종료 시그널을 성공적으로 보냈습니다.', 'success');
            }
        } catch (e) {
            console.error('취소 요청 실패:', e);
            window.showToast('취소 요청 통신 오류', 'error');
        }
    };

    const btnCancelTestAgent = document.getElementById('btn-cancel-test-agent');
    if (btnCancelTestAgent) btnCancelTestAgent.addEventListener('click', handleCancelSandbox);

    const btnCancelManualCommand = document.getElementById('btn-cancel-manual-command');
    if (btnCancelManualCommand) btnCancelManualCommand.addEventListener('click', handleCancelSandbox);

    if (btnGenerateAgent) {
        btnGenerateAgent.addEventListener('click', async () => {
            const reqText = document.getElementById('agent-gen-requirements').value.trim();
            if (!reqText) {
                window.showToast('생성할 에이전트의 설명을 입력해주세요.', 'error');
                return;
            }

            btnGenerateAgent.disabled = true;
            const origHTML = btnGenerateAgent.innerHTML;
            btnGenerateAgent.innerHTML = `<span style="display:inline-flex; align-items:center; gap:6px;">
                <svg style="animation: agent-spin 1s linear infinite;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                    <style>@keyframes agent-spin { 100% { transform: rotate(360deg); } }</style>
                </svg> AI 생성 중...</span>`;

            try {
                const formData = new FormData();
                formData.append('requirements', reqText);
                formData.append('requires_user_prompt', document.getElementById('agent-req-prompt-field').checked);
                formData.append('requires_file_upload', document.getElementById('agent-req-file-field').checked);

                const checkedRadio = document.querySelector('input[name="agent-type"]:checked');
                const isDaemon = (checkedRadio && checkedRadio.value === 'AUTONOMOUS') && document.getElementById('cfg-auto-daemon').checked;
                formData.append('requires_daemon', isDaemon);

                const templateFile = document.getElementById('agent-template-file');
                if (templateFile && templateFile.files.length > 0) {
                    formData.append('template_file', templateFile.files[0]);
                }

                const res = await apiFetch('/api/agents/generate', {
                    method: 'POST',
                    body: formData
                });

                if (res.ok) {
                    const data = await res.json();
                    document.getElementById('agent-name-field').value = data.name || '';
                    document.getElementById('agent-desc-field').value = data.description || '';
                    document.getElementById('agent-prompt-field').value = data.system_prompt || '';
                    document.getElementById('agent-code-field').value = data.python_code || '';
                    if (window.updateCodeLineNumbers) window.updateCodeLineNumbers();
                    document.getElementById('agent-req-file-field').checked = !!data.requires_file_upload;
                    window.showToast('AI가 설정을 모두 작성했습니다! 확인 후 저장하세요.', 'success');
                } else {
                    const err = await res.json();
                    window.showToast(`생성 실패: ${err.error}`, 'error');
                }
            } catch (e) {
                window.showToast('네트워크 오류가 발생했습니다.', 'error');
                console.error(e);
            } finally {
                btnGenerateAgent.disabled = false;
                btnGenerateAgent.innerHTML = origHTML;
            }
        });
    }

    // ─────────────────────────────────────────────────────
    // Settings Logic
    // ─────────────────────────────────────────────────────
    const btnSettingsOpen = document.getElementById('btn-settings-open');
    const modalSettings = document.getElementById('modal-settings');
    const btnsCloseSettings = document.querySelectorAll('.btn-close-settings');

    const tabSettingsProfile = document.getElementById('tab-settings-profile');
    const tabSettingsPassword = document.getElementById('tab-settings-password');
    const panelSettingsProfile = document.getElementById('settings-panel-profile');
    const panelSettingsPassword = document.getElementById('settings-panel-password');

    const settingsProfilePreview = document.getElementById('settings-profile-preview');
    const settingsProfileInitials = document.getElementById('settings-profile-initials');

    function showSettingsModal() {
        if (!modalSettings) return;

        // Reset forms
        document.getElementById('form-settings-profile')?.reset();
        document.getElementById('form-settings-password')?.reset();

        // Show current profile image preview if exists
        if (currentUser && currentUser.profile_image) {
            if (settingsProfilePreview) {
                settingsProfilePreview.src = currentUser.profile_image;
                settingsProfilePreview.style.display = 'block';
            }
            if (settingsProfileInitials) settingsProfileInitials.style.display = 'none';
        } else {
            if (settingsProfilePreview) settingsProfilePreview.style.display = 'none';
            if (settingsProfileInitials) {
                settingsProfileInitials.style.display = 'flex';
                const initials = currentUser?.username?.split(/[\s_-]+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
                settingsProfileInitials.textContent = initials || '?';
            }
        }

        // Default to profile tab
        tabSettingsProfile?.click();
        modalSettings.classList.add('active');
    }

    if (btnSettingsOpen) btnSettingsOpen.addEventListener('click', showSettingsModal);
    btnsCloseSettings.forEach(btn => btn.addEventListener('click', () => modalSettings.classList.remove('active')));

    if (tabSettingsProfile && tabSettingsPassword) {
        tabSettingsProfile.addEventListener('click', () => {
            tabSettingsProfile.classList.add('active');
            tabSettingsPassword.classList.remove('active');
            panelSettingsProfile.classList.remove('hidden');
            panelSettingsPassword.classList.add('hidden');
        });
        tabSettingsPassword.addEventListener('click', () => {
            tabSettingsPassword.classList.add('active');
            tabSettingsProfile.classList.remove('active');
            panelSettingsPassword.classList.remove('hidden');
            panelSettingsProfile.classList.add('hidden');
        });
    }

    // Profile Image Upload
    const formSettingsProfile = document.getElementById('form-settings-profile');
    if (formSettingsProfile) {
        formSettingsProfile.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fileInput = document.getElementById('settings-profile-file');
            if (!fileInput.files.length) {
                window.showToast('이미지 파일을 선택해주세요.', 'error');
                return;
            }

            const btnSubmit = document.getElementById('btn-save-profile');
            const origText = btnSubmit.textContent;
            btnSubmit.disabled = true;
            btnSubmit.textContent = '업로드 중...';

            const formData = new FormData();
            formData.append('file', fileInput.files[0]);

            try {
                const res = await apiFetch('/api/users/me/profile_image', {
                    method: 'POST',
                    body: formData
                });
                if (res.ok) {
                    const data = await res.json();
                    window.showToast(data.message, 'success');

                    // Update user state
                    currentUser.profile_image = data.profile_image;
                    localStorage.setItem('rag_user', JSON.stringify(currentUser));

                    // Update UI
                    initApp();
                    showSettingsModal(); // Refresh preview
                } else {
                    const err = await res.json();
                    window.showToast(`업로드 실패: ${err.error}`, 'error');
                }
            } catch (err) {
                console.error(err);
                window.showToast('서버 연결 오류', 'error');
            } finally {
                btnSubmit.disabled = false;
                btnSubmit.textContent = origText;
            }
        });
    }

    // Check local file select to update preview immediately
    const settingsProfileFileInput = document.getElementById('settings-profile-file');
    if (settingsProfileFileInput) {
        settingsProfileFileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = function (e) {
                    if (settingsProfilePreview) {
                        settingsProfilePreview.src = e.target.result;
                        settingsProfilePreview.style.display = 'block';
                    }
                    if (settingsProfileInitials) settingsProfileInitials.style.display = 'none';
                }
                reader.readAsDataURL(e.target.files[0]);
            }
        });
    }

    // Password Change
    const formSettingsPassword = document.getElementById('form-settings-password');
    if (formSettingsPassword) {
        formSettingsPassword.addEventListener('submit', async (e) => {
            e.preventDefault();
            const curPw = document.getElementById('settings-current-pw').value;
            const newPw = document.getElementById('settings-new-pw').value;
            const confirmPw = document.getElementById('settings-confirm-pw').value;

            if (newPw !== confirmPw) {
                window.showToast('새 비밀번호가 일치하지 않습니다.', 'error');
                return;
            }

            if (newPw.length < 4) {
                window.showToast('비밀번호는 최소 4자 이상이어야 합니다.', 'error');
                return;
            }

            const btnSubmit = document.getElementById('btn-save-password');
            const origText = btnSubmit.textContent;
            btnSubmit.disabled = true;
            btnSubmit.textContent = '변경 중...';

            try {
                const res = await apiFetch('/api/users/me/password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        current_password: curPw,
                        new_password: newPw
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    window.showToast(data.message, 'success');
                    formSettingsPassword.reset();
                    modalSettings.classList.remove('active');
                } else {
                    const err = await res.json();
                    window.showToast(`비밀번호 변경 실패: ${err.error}`, 'error');
                }
            } catch (err) {
                console.error(err);
                window.showToast('서버 연결 오류', 'error');
            } finally {
                btnSubmit.disabled = false;
                btnSubmit.textContent = origText;
            }
        });
    }

    // --- Shared Groups Management ---
    let mySharedGroups = [];
    let currentEditingGroupId = null;
    let currentEditingMembers = [];

    window.loadSharedGroups = async function () {
        try {
            const res = await apiFetch('/api/shared-groups');
            if (res.ok) {
                const data = await res.json();
                mySharedGroups = data.groups || [];
                renderSharedGroupsList();
                updateVisibilityDropdowns();
            }
        } catch (err) {
            console.error("Failed to load shared groups", err);
        }
    };

    function renderSharedGroupsList() {
        const list = document.getElementById('shared-groups-list');
        if (!list) return;
        list.innerHTML = '';

        if (mySharedGroups.length === 0) {
            list.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-secondary); font-size: 0.9rem;">공유 그룹이 없습니다.</div>';
            return;
        }

        mySharedGroups.forEach((g, index) => {
            const div = document.createElement('div');
            div.className = `folder-item ${currentEditingGroupId === g.id ? 'selected' : ''}`;
            div.style.padding = '12px 14px';
            div.style.margin = '2px 0';
            div.style.borderRadius = '6px';
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.cursor = 'pointer';
            div.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px;">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <span class="folder-name">${escapeHtml(g.name)}</span>
            `;
            div.addEventListener('click', () => window.openSharedGroupEditor(g.id));
            list.appendChild(div);

            // Add separator between groups
            const hr = document.createElement('hr');
            hr.style.margin = '2px 14px';
            hr.style.border = 'none';
            hr.style.borderTop = '1px solid var(--border-color)';
            hr.style.opacity = '0.5';
            list.appendChild(hr);
        });
    }

    window.openSharedGroupEditor = function (groupId) {
        document.getElementById('shared-group-placeholder').style.display = 'none';
        const editor = document.getElementById('shared-group-editor');
        editor.style.display = 'block';

        const btnDelete = document.getElementById('btn-delete-shared-group');

        if (groupId) {
            const group = mySharedGroups.find(g => g.id === groupId);
            if (!group) return;
            currentEditingGroupId = group.id;
            document.getElementById('shared-group-editor-title').textContent = '공유 그룹 수정';
            document.getElementById('shared-group-name').value = group.name;
            currentEditingMembers = [...group.members];
            btnDelete.classList.remove('hidden');
        } else {
            currentEditingGroupId = null;
            document.getElementById('shared-group-editor-title').textContent = '새 공유 그룹';
            document.getElementById('shared-group-name').value = '';
            currentEditingMembers = [];
            btnDelete.classList.add('hidden');
        }

        document.getElementById('shared-group-search-input').value = '';
        document.getElementById('shared-group-search-results').classList.add('hidden');
        renderSharedGroupMembers();
        renderSharedGroupsList();
    };

    function renderSharedGroupMembers() {
        const container = document.getElementById('shared-group-members-container');
        if (!container) return;
        container.innerHTML = '';
        if (currentEditingMembers.length === 0) {
            container.innerHTML = '<span class="empty-state" style="color: var(--text-secondary); font-size: 0.9rem; margin: auto;">추가된 멤버가 없습니다.</span>';
            return;
        }

        currentEditingMembers.forEach((m, idx) => {
            const tag = document.createElement('div');
            tag.style.background = m.target_type === 'organization' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(168, 85, 247, 0.2)';
            tag.style.border = `1px solid ${m.target_type === 'organization' ? 'rgba(56, 189, 248, 0.5)' : 'rgba(168, 85, 247, 0.5)'}`;
            tag.style.borderRadius = '20px';
            tag.style.padding = '4px 10px';
            tag.style.fontSize = '0.85rem';
            tag.style.display = 'flex';
            tag.style.alignItems = 'center';
            tag.style.gap = '6px';

            tag.innerHTML = `
                <span>${escapeHtml(m.display)}</span>
                <button type="button" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 0; display: flex;" title="삭제">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            `;
            tag.querySelector('button').addEventListener('click', () => {
                currentEditingMembers.splice(idx, 1);
                renderSharedGroupMembers();
            });
            container.appendChild(tag);
        });
    }

    const searchInput = document.getElementById('shared-group-search-input');
    const searchBtn = document.getElementById('btn-search-shared-group');
    const searchResults = document.getElementById('shared-group-search-results');

    async function performSharedGroupSearch() {
        if (!searchInput) return;
        const q = searchInput.value.trim();
        if (q.length < 1) return;
        try {
            const res = await apiFetch(`/api/search/members?q=${encodeURIComponent(q)}`);
            if (res.ok) {
                const data = await res.json();
                renderSearchResults(data.results);
            }
        } catch (e) {
            console.error(e);
        }
    }

    if (searchBtn) searchBtn.addEventListener('click', performSharedGroupSearch);
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSharedGroupSearch();
            }
        });
    }

    function renderSearchResults(results) {
        if (!searchResults) return;
        searchResults.innerHTML = '';
        if (results.length === 0) {
            searchResults.innerHTML = '<div style="padding: 12px; color: var(--text-secondary); text-align: center;">검색 결과가 없습니다.</div>';
        } else {
            results.forEach(r => {
                const item = document.createElement('div');
                item.className = 'search-result-item list-item';
                item.style.padding = '10px 12px';
                item.style.cursor = 'pointer';
                item.style.borderBottom = '1px solid var(--border-color)';
                item.innerHTML = `
                    <div style="font-weight: 500;">${escapeHtml(r.display)}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">${r.target_type === 'user' ? '사용자' : '조직'}</div>
                `;
                item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-secondary)');
                item.addEventListener('mouseleave', () => item.style.background = '');
                item.addEventListener('click', () => {
                    if (!currentEditingMembers.some(m => m.target_type === r.target_type && m.target_id === r.target_id)) {
                        currentEditingMembers.push(r);
                        renderSharedGroupMembers();
                    }
                    searchResults.classList.add('hidden');
                    searchInput.value = '';
                });
                searchResults.appendChild(item);
            });
        }
        searchResults.classList.remove('hidden');
    }

    document.addEventListener('click', (e) => {
        if (searchResults && !searchResults.contains(e.target) && e.target !== searchInput && e.target !== searchBtn) {
            searchResults.classList.add('hidden');
        }
    });

    const btnCreateGroup = document.getElementById('btn-create-shared-group');
    if (btnCreateGroup) {
        btnCreateGroup.addEventListener('click', () => window.openSharedGroupEditor(null));
    }

    const btnSaveGroup = document.getElementById('btn-save-shared-group');
    if (btnSaveGroup) {
        btnSaveGroup.addEventListener('click', async () => {
            const name = document.getElementById('shared-group-name').value.trim();
            if (!name) return window.showToast('그룹 이름을 입력하세요.', 'error');
            if (currentEditingMembers.length === 0) return window.showToast('최소 한 명의 멤버를 추가하세요.', 'error');

            const payload = {
                name: name,
                members: currentEditingMembers.map(m => ({ target_type: m.target_type, target_id: m.target_id }))
            };

            try {
                let url = '/api/shared-groups';
                let method = 'POST';
                if (currentEditingGroupId) {
                    url += `/${currentEditingGroupId}`;
                    method = 'PUT';
                }
                const res = await apiFetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    window.showToast(currentEditingGroupId ? '그룹이 수정되었습니다.' : '그룹이 생성되었습니다.', 'success');
                    await window.loadSharedGroups();
                    window.openSharedGroupEditor(null);
                    document.getElementById('shared-group-editor').style.display = 'none';
                    document.getElementById('shared-group-placeholder').style.display = 'flex';
                } else {
                    const err = await res.json();
                    window.showToast(`오류: ${err.error}`, 'error');
                }
            } catch (e) {
                console.error(e);
                window.showToast('서버 연결 오류', 'error');
            }
        });
    }

    const btnDeleteGroup = document.getElementById('btn-delete-shared-group');
    if (btnDeleteGroup) {
        btnDeleteGroup.addEventListener('click', async () => {
            if (!currentEditingGroupId) return;
            if (!(await window.showConfirm('정말 이 공유 그룹을 삭제하시겠습니까?', '공유 그룹 삭제', '삭제'))) return;

            try {
                const res = await apiFetch(`/api/shared-groups/${currentEditingGroupId}`, { method: 'DELETE' });
                if (res.ok) {
                    window.showToast('그룹이 삭제되었습니다.', 'success');
                    await window.loadSharedGroups();
                    window.openSharedGroupEditor(null);
                    document.getElementById('shared-group-editor').style.display = 'none';
                    document.getElementById('shared-group-placeholder').style.display = 'flex';
                } else {
                    const err = await res.json();
                    window.showToast(`오류: ${err.error}`, 'error');
                }
            } catch (e) {
                console.error(e);
                window.showToast('서버 연결 오류', 'error');
            }
        });
    }

    function updateVisibilityDropdowns() {
        const dropdowns = [
            document.getElementById('upload-visibility'),
            document.getElementById('select-folder-visibility'),
            document.getElementById('agent-share-field')
        ];

        dropdowns.forEach(dd => {
            if (!dd) return;
            Array.from(dd.options).forEach(opt => {
                if (opt.value.startsWith('group_')) dd.removeChild(opt);
            });
            mySharedGroups.forEach(g => {
                const option = document.createElement('option');
                option.value = `group_${g.id}`;
                option.textContent = `공유 그룹: ${g.name}`;
                dd.appendChild(option);
            });
        });
    }

    // Call initApp which triggers initial data loads

    // Daemon UI Controls
    let daemonLogInterval = null;
    window._refreshDaemonLogs = async function () {
        if (!activeAgentId) return;
        const panel = document.getElementById('daemon-control-panel');
        if (!panel || panel.style.display === 'none') return;

        try {
            const res = await apiFetch(`/api/agents/${activeAgentId}/daemon/status`);
            if (res.ok) {
                const data = await res.json();
                const indicator = document.getElementById('daemon-status-indicator');
                if (indicator) {
                    indicator.style.backgroundColor = data.running ? '#10b981' : '#9ca3af';
                }
                const btnStart = document.getElementById('btn-daemon-start');
                const btnStop = document.getElementById('btn-daemon-stop');
                if (data.running) {
                    if (btnStart) btnStart.style.display = 'none';
                    if (btnStop) btnStop.style.display = 'flex';
                } else {
                    if (btnStart) btnStart.style.display = 'flex';
                    if (btnStop) btnStop.style.display = 'none';
                }
                const logField = document.getElementById('daemon-logs-textarea');
                if (logField) {
                    const atBottom = (logField.scrollTop + logField.clientHeight >= logField.scrollHeight - 10);
                    logField.value = data.logs || 'No logs yet.';
                    if (atBottom) logField.scrollTop = logField.scrollHeight;
                }
            }
        } catch (e) {
            console.error("Failed to fetch daemon status", e);
        }
    };

    function initDaemonControls() {
        const btnStart = document.getElementById('btn-daemon-start');
        const btnStop = document.getElementById('btn-daemon-stop');
        const btnRefresh = document.getElementById('btn-daemon-refresh-logs');
        const cfgDaemon = document.getElementById('cfg-auto-daemon');

        if (cfgDaemon) {
            cfgDaemon.addEventListener('change', (e) => {
                let cfgObj = {};
                cfgObj['cfg-auto-daemon'] = e.target.checked;
                updateAgentConfigVisibility('AUTONOMOUS', cfgObj);
            });
        }

        if (btnStart) {
            btnStart.addEventListener('click', async (e) => {
                e.preventDefault();
                if (!activeAgentId) {
                    window.showToast('먼저 에이전트를 저장하세요.', 'error'); return;
                }
                try {
                    const res = await apiFetch(`/api/agents/${activeAgentId}/daemon/start`, { method: 'POST' });
                    if (res.ok) {
                        window.showToast('데몬 프로세스를 시작했습니다.', 'success');
                        window._refreshDaemonLogs();
                    } else {
                        const err = await res.json();
                        window.showToast(err.error || '시작 실패', 'error');
                    }
                } catch (e) { }
            });
        }
        if (btnStop) {
            btnStop.addEventListener('click', async (e) => {
                e.preventDefault();
                if (!activeAgentId) return;
                try {
                    const res = await apiFetch(`/api/agents/${activeAgentId}/daemon/stop`, { method: 'POST' });
                    if (res.ok) {
                        window.showToast('데몬 프로세스를 정지했습니다.', 'success');
                        window._refreshDaemonLogs();
                    }
                } catch (e) { }
            });
        }
        if (btnRefresh) {
            btnRefresh.addEventListener('click', (e) => {
                e.preventDefault();
                window._refreshDaemonLogs();
            });
        }

        // Auto refresh every 10 seconds if panel is visible
        if (daemonLogInterval) clearInterval(daemonLogInterval);
        daemonLogInterval = setInterval(() => {
            const panel = document.getElementById('daemon-control-panel');
            if (panel && panel.style.display !== 'none') {
                window._refreshDaemonLogs();
            }
        }, 10000);
    }

    // Line Numbers Sync for Code Editor
    const editorEl = document.getElementById('agent-code-field');
    const lineNumbersEl = document.getElementById('agent-code-line-numbers');
    if (editorEl && lineNumbersEl) {
        const updateLines = () => {
            const lines = editorEl.value.split('\n').length;
            let nHtml = '';
            // Ensure at least 1 line is always rendered, or dynamically grow
            const renderCount = Math.max(lines, 1);
            for (let i = 1; i <= renderCount; i++) nHtml += i + '<br>';
            lineNumbersEl.innerHTML = nHtml;
            // Restore scroll position after innerHTML replace resets it
            if (editorEl) lineNumbersEl.scrollTop = editorEl.scrollTop;
        };
        editorEl.addEventListener('input', updateLines);
        editorEl.addEventListener('scroll', () => {
            lineNumbersEl.scrollTop = editorEl.scrollTop;
        });
        updateLines();
        window.updateCodeLineNumbers = updateLines;
    } else {
        window.updateCodeLineNumbers = () => { };
    }

    // --- Global Background Polling for API Document Uploads ---
    // Periodically checks for new documents uploaded via API and refreshes the list
    window.lastDocsDataString = null;
    window.backgroundDocsPolling = setInterval(async () => {
        // Prevent polling if completely logged out
        if (!authToken) return;

        const manageArea = document.getElementById('manage-area');
        const mainApp = document.getElementById('main-app');
        // Only poll if the user is currently on the Document Management tab and App is visible
        if (!manageArea || manageArea.classList.contains('hidden') || (mainApp && mainApp.classList.contains('hidden'))) return;

        // Don't interfere if fast-polling is already running during an active web upload
        if (window.pollingInterval) return;

        try {
            const res = await apiFetch('/api/documents');
            if (res.ok) {
                const data = await res.json();
                const newDataString = JSON.stringify(data);

                // Only trigger DOM update if the actual document data has changed
                if (window.lastDocsDataString !== null && window.lastDocsDataString !== newDataString) {
                    updateDocsList(data);
                }
                window.lastDocsDataString = newDataString;
            }
        } catch (err) {
            console.error('Background doc polling error:', err);
        }
    }, 5000); // Check every 5 seconds
    
    // --- Global Notifications Polling ---
    window.systemNotificationsPolling = setInterval(async () => {
        if (!authToken) return;
        try {
            const res = await apiFetch('/api/client/notifications');
            if (res.ok) {
                const data = await res.json();
                if (data.notifications && data.notifications.length > 0) {
                    data.notifications.forEach(note => {
                        window.showToast(note.message, note.type || 'info');
                    });
                }
            }
        } catch (err) {
            // fail silently
        }
    }, 30000);
    // -----------------------------------------------------------

    initDaemonControls();
    initApp();

    // ==========================================
    // Admin Usage Statistics Logic
    // ==========================================

    let usageChartInstance = null;

    window.initAdminStats = async function () {
        const startDateInput = document.getElementById('stats-start-date');
        const endDateInput = document.getElementById('stats-end-date');

        // Default: 1st of current month to today
        if (!startDateInput.value || !endDateInput.value) {
            const today = new Date();
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

            // Adjust to local timezone strings
            const offset = today.getTimezoneOffset() * 60000;
            const localStart = new Date(startOfMonth.getTime() - offset);
            const localToday = new Date(today.getTime() - offset);

            startDateInput.value = localStart.toISOString().split('T')[0];
            endDateInput.value = localToday.toISOString().split('T')[0];
        }

        await loadUsageStats();
    };

    async function loadUsageStats() {
        const startDate = document.getElementById('stats-start-date').value;
        const endDate = document.getElementById('stats-end-date').value;

        try {
            const res = await apiFetch(`/api/admin/stats/usage?start_date=${startDate}&end_date=${endDate}`);
            if (!res.ok) throw new Error('Failed to fetch stats');
            const data = await res.json();

            renderUsageChart(data.daily_trends);
            renderUsageTable(data.user_rankings);
            updateSummaryCards(data.user_rankings);
        } catch (e) {
            console.error(e);
            alert('통계 데이터를 불러오는데 실패했습니다.');
        }
    }

    function updateSummaryCards(rankings) {
        let totalTokens = 0;
        let totalCost = 0.0;
        let activeUsers = 0;

        if (rankings && rankings.length > 0) {
            activeUsers = rankings.length;
            rankings.forEach(user => {
                totalTokens += user.total_tokens;
                totalCost += user.total_cost;
            });
        }

        const elTokens = document.getElementById('stats-summary-tokens');
        const elCost = document.getElementById('stats-summary-cost');
        const elUsers = document.getElementById('stats-summary-users');

        if (elTokens) elTokens.textContent = totalTokens.toLocaleString();
        if (elCost) elCost.textContent = '$' + totalCost.toFixed(4);
        if (elUsers) elUsers.textContent = activeUsers + ' 명';
    }

    function renderUsageChart(dailyTrends) {
        const canvas = document.getElementById('tokensChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        if (usageChartInstance) {
            usageChartInstance.destroy();
        }

        const dates = Object.keys(dailyTrends).sort();

        // Group by models
        const modelsSet = new Set();
        dates.forEach(d => {
            Object.keys(dailyTrends[d]).forEach(m => modelsSet.add(m));
        });

        const colors = [
            'rgba(99, 102, 241, 0.85)', 'rgba(56, 189, 248, 0.85)', 'rgba(16, 185, 129, 0.85)', 'rgba(245, 158, 11, 0.85)', 'rgba(239, 68, 68, 0.85)', 'rgba(139, 92, 246, 0.85)'
        ];

        const datasets = Array.from(modelsSet).map((modelName, index) => {
            const data = dates.map(d => dailyTrends[d][modelName] || 0);
            return {
                label: modelName,
                data: data,
                backgroundColor: colors[index % colors.length],
                borderColor: colors[index % colors.length].replace('0.85', '1'),
                borderWidth: 1,
                borderRadius: 4,
            };
        });

        usageChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: dates,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                    y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Tokens' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
                },
                plugins: {
                    tooltip: { mode: 'index', intersect: false }
                }
            }
        });
    }

    function renderUsageTable(rankings) {
        const tbody = document.querySelector('#table-user-rankings tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!rankings || rankings.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--text-secondary);">데이터가 없습니다.</td></tr>';
            return;
        }

        rankings.forEach((user, index) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = "1px solid var(--border-color)";
            tr.style.transition = "background-color 0.2s";
            tr.addEventListener('mouseenter', () => tr.style.backgroundColor = 'rgba(255,255,255,0.02)');
            tr.addEventListener('mouseleave', () => tr.style.backgroundColor = 'transparent');

            tr.innerHTML = `
                <td style="padding: 12px 16px;">${index + 1}</td>
                <td style="padding: 12px 16px; font-weight: 500;">${user.username}</td>
                <td style="padding: 12px 16px;">${user.full_name || '-'}</td>
                <td style="padding: 12px 16px; text-align: right;" title="입력 토큰: ${user.total_prompt.toLocaleString()} | 출력 토큰: ${user.total_completion.toLocaleString()}">
                    ${user.total_tokens.toLocaleString()} <span style="font-size: 0.75rem; color: var(--text-secondary); margin-left: 4px;">Tokens</span>
                </td>
                <td style="padding: 12px 16px; font-weight: 600; color: #38bdf8; text-align: right;" title="비용 상세내역은 툴팁 참고">$${user.total_cost.toFixed(4)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // Stats UI Listeners
    document.getElementById('btn-refresh-stats')?.addEventListener('click', loadUsageStats);

    document.getElementById('btn-stats-settings')?.addEventListener('click', async () => {
        document.getElementById('pricing-modal').classList.remove('hidden');
        await loadPricingList();
    });

    document.getElementById('btn-close-pricing')?.addEventListener('click', () => {
        document.getElementById('pricing-modal').classList.add('hidden');
        loadUsageStats(); // Refresh cost estimates upon closing
    });

    document.getElementById('form-add-pricing')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const model = document.getElementById('stats-model-name').value;
        const promptCost = document.getElementById('stats-cost-prompt').value;
        const compCost = document.getElementById('stats-cost-comp').value;

        try {
            const res = await apiFetch('/api/admin/stats/pricing', {
                method: 'POST',
                body: JSON.stringify({
                    model_name: model,
                    cost_per_1m_prompt: parseFloat(promptCost),
                    cost_per_1m_completion: parseFloat(compCost)
                })
            });
            if (res.ok) {
                document.getElementById('form-add-pricing').reset();
                await loadPricingList();
            } else {
                alert('단가 설정 중 오류가 발생했습니다.');
            }
        } catch (err) {
            console.error(err);
        }
    });

    async function loadPricingList() {
        const tbody = document.querySelector('#table-pricing tbody');
        if (!tbody) return;
        try {
            const res = await apiFetch('/api/admin/stats/pricing');
            const list = await res.json();
            tbody.innerHTML = '';
            list.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${item.model_name}</td>
                    <td>$ ${item.cost_per_1m_prompt}</td>
                    <td>$ ${item.cost_per_1m_completion}</td>
                    <td><button class="btn-danger-text" onclick="deletePricing('${item.model_name}')" style="padding:4px 8px; font-size:12px;">삭제</button></td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) {
            console.error(e);
        }
    }

    window.deletePricing = async function (modelName) {
        if (!confirm(`'${modelName}'의 단가 설정을 삭제하시겠습니까?`)) return;
        try {
            await apiFetch(`/api/admin/stats/pricing/${modelName}`, { method: 'DELETE' });
            loadPricingList();
        } catch (e) { console.error(e); }
    };

    // Toggle Advanced Crawl Options
    const advCrawlOptionsToggle = document.getElementById('adv-crawl-options-toggle');
    const advCrawlOptionsBody = document.getElementById('adv-crawl-options-body');
    if (advCrawlOptionsToggle && advCrawlOptionsBody) {
        advCrawlOptionsToggle.addEventListener('click', () => {
            if (advCrawlOptionsBody.style.display === 'none') {
                advCrawlOptionsBody.style.display = 'block';
                advCrawlOptionsToggle.querySelector('span:last-child').textContent = '▲';
            } else {
                advCrawlOptionsBody.style.display = 'none';
                advCrawlOptionsToggle.querySelector('span:last-child').textContent = '▼';
            }
        });
    }

    const crawlUseAi = document.getElementById('crawl-use-ai');
    const aiExtractPromptContainer = document.getElementById('ai-extract-prompt-container');
    const aiExtractWrapper = document.getElementById('ai-extract-wrapper');
    const crawlModeSelect = document.getElementById('crawl-mode');

    const crawlRestrictPathCb = document.getElementById('crawl-restrict-path');

    if (crawlUseAi && aiExtractPromptContainer) {
        crawlUseAi.addEventListener('change', (e) => {
            aiExtractPromptContainer.style.display = e.target.checked ? 'block' : 'none';
            if (crawlRestrictPathCb) {
                if (e.target.checked) {
                    crawlRestrictPathCb.checked = false;
                    crawlRestrictPathCb.disabled = true;
                } else {
                    crawlRestrictPathCb.disabled = false;
                }
            }
        });
    }

    if (crawlModeSelect && aiExtractWrapper) {
        const toggleAiWrapper = () => {
            if (crawlModeSelect.value === 'static') {
                aiExtractWrapper.style.display = 'block';
            } else {
                aiExtractWrapper.style.display = 'none';
                if (crawlUseAi) {
                    crawlUseAi.checked = false;
                    crawlUseAi.dispatchEvent(new Event('change'));
                }
                if (aiExtractPromptContainer) aiExtractPromptContainer.style.display = 'none';
            }
        };
        crawlModeSelect.addEventListener('change', toggleAiWrapper);
        // Initialize
        toggleAiWrapper();
    }

    try {
        const savedOptions = JSON.parse(localStorage.getItem('rag_crawl_options') || '{}');
        const _crawlModeSelect = document.getElementById('crawl-mode');
        if (savedOptions.crawl_type && _crawlModeSelect) _crawlModeSelect.value = savedOptions.crawl_type;
        if (savedOptions.strategy) { const s = document.getElementById('crawl-strategy'); if(s) s.value = savedOptions.strategy; }
        if (savedOptions.max_depth) { const d = document.getElementById('crawl-max-depth'); if(d) d.value = savedOptions.max_depth; }
        if (savedOptions.max_pages) { const p = document.getElementById('crawl-max-pages'); if(p) p.value = savedOptions.max_pages; }
        if (savedOptions.restrict_path !== undefined) { const r = document.getElementById('crawl-restrict-path'); if(r) r.checked = savedOptions.restrict_path; }
        if (savedOptions.use_ai_extraction !== undefined) { const a = document.getElementById('crawl-use-ai'); if(a) a.checked = savedOptions.use_ai_extraction; }
        if (savedOptions.ai_extraction_prompt) { const ap = document.getElementById('crawl-ai-prompt'); if(ap) ap.value = savedOptions.ai_extraction_prompt; }
        
        if (_crawlModeSelect) _crawlModeSelect.dispatchEvent(new Event('change'));
        const _crawlUseAi = document.getElementById('crawl-use-ai');
        if (_crawlUseAi) _crawlUseAi.dispatchEvent(new Event('change'));
    } catch(e) {}

    const formCrawlWebsite = document.getElementById('form-crawl-website');
    if (formCrawlWebsite) {
        formCrawlWebsite.addEventListener('submit', async (e) => {
            e.preventDefault();
            const url = document.getElementById('crawl-url').value;
            const siteName = document.getElementById('crawl-site-name').value;
            const maxPages = document.getElementById('crawl-max-pages').value;
            const maxDepth = document.getElementById('crawl-max-depth')?.value || 3;
            const crawlType = document.getElementById('crawl-mode')?.value || "spa";
            const crawlStrategy = document.getElementById('crawl-strategy')?.value || "bfs";
            const restrictPath = document.getElementById('crawl-restrict-path')?.checked || false;

            const useAiExtraction = document.getElementById('crawl-use-ai')?.checked || false;
            const aiExtractionPrompt = document.getElementById('crawl-ai-prompt')?.value || null;

            const loginId = document.getElementById('crawl-login-id')?.value || null;
            const loginPw = document.getElementById('crawl-login-pw')?.value || null;
            const searchKeyword = document.getElementById('crawl-search-keyword')?.value || null;

            const fieldset = document.getElementById('crawl-fieldset');
            const statusContainer = document.getElementById('crawl-status-container');

            fieldset.disabled = true;
            statusContainer.classList.remove('hidden');

            try {
                localStorage.setItem('rag_crawl_options', JSON.stringify({
                    crawl_type: crawlType,
                    strategy: crawlStrategy,
                    max_depth: maxDepth,
                    max_pages: maxPages,
                    restrict_path: restrictPath,
                    use_ai_extraction: useAiExtraction,
                    ai_extraction_prompt: aiExtractionPrompt
                }));
            } catch(e) {}

            try {
                const response = await apiFetch('/api/documents/crawl', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: url,
                        site_name: siteName,
                        folder_id: window.currentFolderId && window.currentFolderId !== "null" ? parseInt(window.currentFolderId) : null,
                        max_pages: parseInt(maxPages) || 50,
                        max_depth: parseInt(maxDepth) || 3,
                        crawl_type: crawlType,
                        strategy: crawlStrategy,
                        restrict_path: restrictPath,
                        login_id: loginId,
                        login_pw: loginPw,
                        search_keyword: searchKeyword,
                        use_ai_extraction: useAiExtraction,
                        ai_extraction_prompt: aiExtractionPrompt
                    })
                });

                const data = await response.json();
                if (response.ok) {
                    window.showToast(`✅ ${data.message}`, 'success');
                    formCrawlWebsite.reset();
                    await loadWebsiteList();
                    if (data.doc_id) {
                        window.selectWebsite(data.doc_id);
                    }
                } else {
                    alert(`🚨 크롤링 실패: ${data.error}`);
                }
            } catch (err) {
                alert(`통신 오류: ${err.message}`);
            } finally {
                fieldset.disabled = false;
                statusContainer.classList.add('hidden');
            }
        });
    }

    // ====== Website Management Dashboard ======
    const websitesListContainer = document.getElementById('websites-list-container');
    const websiteRegistrationView = document.getElementById('website-registration-view');
    const websiteDetailsView = document.getElementById('website-details-view');
    const btnCreateWebsiteNew = document.getElementById('btn-create-website-new');

    let currentSelectedWebsiteId = null;
    let websiteDocsCache = [];

    async function loadWebsiteList() {
        if (!websitesListContainer) return;
        try {
            // Add timestamp query string to prevent aggressive browser caching on GET requests
            const ts = new Date().getTime();
            const res = await apiFetch(`/api/documents?_t=${ts}`);
            const data = await res.json();
            const docs = [...(data.my_documents || []), ...(data.public_documents || []), ...(data.group_documents || []), ...(data.organization_documents || [])];

            // Remove duplicates efficiently
            const uniqueDocs = Array.from(new Map(docs.map(item => [item.id, item])).values());
            const websiteDocs = uniqueDocs.filter(d => d.safe_filename && d.safe_filename.endsWith('.url'));

            websiteDocs.sort((a, b) => new Date(b.upload_date) - new Date(a.upload_date));
            websiteDocsCache = websiteDocs;

            websitesListContainer.innerHTML = '';
            if (websiteDocs.length === 0) {
                websitesListContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-secondary);">등록된 웹사이트가 없습니다.</div>`;
                return;
            }

            websiteDocs.forEach(doc => {
                const item = document.createElement('div');
                item.className = 'folder-tree-item';
                if (currentSelectedWebsiteId === doc.id) {
                    item.classList.add('selected');
                }
                item.style.padding = '8px 12px';
                item.style.cursor = 'pointer';
                item.style.borderBottom = '1px solid var(--border-color)';

                let icon = '🌐';
                if (doc.status === 'pending' || doc.status === 'processing') icon = '⏳';
                else if (doc.status === 'failed') icon = '❌';

                item.innerHTML = `
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span>${icon}</span>
                        <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-grow:1; display:flex; flex-direction:column; gap:2px;">
                            <strong style="font-size: 0.95rem;">${(doc.name || '').replace('[WEBSITE] ', '') || '이름 없음'}</strong>
                            <span style="font-size: 0.75rem; color: var(--text-secondary);">${(doc.file_path || '').replace('[WEBSITE] ', '').substring(0, 35)}</span>
                        </div>
                    </div>
                `;
                item.addEventListener('click', () => selectWebsite(doc.id));
                websitesListContainer.appendChild(item);
            });

            if (currentSelectedWebsiteId) {
                // Ensure detail is open if it's supposed to be
                selectWebsite(currentSelectedWebsiteId, true);
            }
        } catch (e) { console.error(e); }
    }

    if (btnCreateWebsiteNew) {
        btnCreateWebsiteNew.addEventListener('click', () => {
            currentSelectedWebsiteId = null;
            loadWebsiteList();
            websiteRegistrationView.classList.remove('hidden');
            websiteDetailsView.classList.add('hidden');
        });
    }

    window.selectWebsite = function (docId, forceRefresh = false) {
        if (currentSelectedWebsiteId === docId && !forceRefresh) return;
        currentSelectedWebsiteId = docId;

        if (websitesListContainer) {
            Array.from(websitesListContainer.children).forEach(child => child.classList.remove('selected'));
        }

        if (!docId) {
            document.getElementById('website-editor-title').textContent = '새 웹사이트 크롤링 및 등록';
            websiteRegistrationView.classList.remove('hidden');
            websiteDetailsView.classList.add('hidden');
            return;
        }

        const doc = websiteDocsCache.find(d => d.id === docId);
        if (!doc) return;

        websiteRegistrationView.classList.add('hidden');
        websiteDetailsView.classList.remove('hidden');

        document.getElementById('website-editor-title').textContent = '웹사이트 크롤링 관리';
        document.getElementById('website-detail-title').textContent = (doc.name || '').replace('[WEBSITE] ', '') || '이름 없음';

        const statusEl = document.getElementById('website-detail-status');
        if (doc.status === 'ready') {
            statusEl.textContent = '완료됨';
            statusEl.style.background = 'var(--success-bg)';
            statusEl.style.color = 'var(--success)';
        } else if (doc.status === 'failed') {
            statusEl.textContent = '오류 발생';
            statusEl.style.background = 'rgba(239, 68, 68, 0.1)';
            statusEl.style.color = 'var(--danger)';
        } else {
            statusEl.textContent = `진행 중 (${doc.progress_percent || 0}%)`;
            statusEl.style.background = 'rgba(99, 102, 241, 0.1)';
            statusEl.style.color = 'var(--accent-primary)';
        }

        document.getElementById('website-detail-date').textContent = doc.upload_date;
        document.getElementById('website-detail-updated').textContent = doc.updated_at || doc.upload_date;
        const originalUrl = (doc.file_path || '').replace('[WEBSITE] ', '');
        const urlEl = document.getElementById('website-detail-url');
        urlEl.textContent = originalUrl.length > 50 ? originalUrl.substring(0, 50) + "..." : originalUrl;
        urlEl.href = originalUrl;

        document.getElementById('website-detail-progress').textContent = doc.progress || '정상 (대기 상태)';

        const scheduleVal = doc.auto_crawl_schedule || 'disable';
        const scheduleSelect = document.getElementById('website-detail-schedule');
        if (scheduleSelect) {
            scheduleSelect.value = scheduleVal;
            const newScheduleSelect = scheduleSelect.cloneNode(true);
            newScheduleSelect.value = scheduleVal;  // CRITICAL: cloneNode does not preserve the javascript .value state!
            scheduleSelect.parentNode.replaceChild(newScheduleSelect, scheduleSelect);
            
            newScheduleSelect.addEventListener('change', async (e) => {
                try {
                    await apiFetch(`/api/websites/${doc.id}/schedule`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ schedule: e.target.value })
                    });
                    doc.auto_crawl_schedule = e.target.value;
                    window.showToast("자동 크롤링 주기가 적용되었습니다.", "success");
                } catch (err) {
                    window.showToast("주기 변경 실패: " + (err.error || ""), "error");
                    newScheduleSelect.value = scheduleVal;
                }
            });
        }

        document.getElementById('detail-btn-viewer').onclick = () => window.viewWebsiteText(doc.id, originalUrl);
        document.getElementById('detail-btn-recrawl').onclick = () => window.recrawlWebsite(doc.id);
        document.getElementById('detail-btn-delete').onclick = () => window.deleteWebsite(doc.id, doc.name);

        const btnStop = document.getElementById('detail-btn-stop');
        if (doc.status === 'pending' || doc.status === 'processing') {
            btnStop.style.display = 'inline-block';
            btnStop.onclick = () => window.stopWebsiteCrawl(doc.id);
        } else {
            btnStop.style.display = 'none';
        }

        window.refreshInlineLogs(doc.status, forceRefresh);
    };

    window.refreshInlineLogs = async function (status = null, isPolling = false) {
        if (!currentSelectedWebsiteId) return;
        const tbody = document.getElementById('inline-crawl-logs');
        if (!tbody) return;

        const isCompleted = (status === 'ready' || status === 'failed' || status === 'error');
        
        if (isPolling && isCompleted) {
            if (window._lastLogFetchStatus === status && window._lastLogFetchId === currentSelectedWebsiteId) {
                return; // Do not spam network for already completed websites
            }
        }
        
        window._lastLogFetchStatus = status;
        window._lastLogFetchId = currentSelectedWebsiteId;

        if (!isPolling || tbody.innerHTML.trim() === '') {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 20px;">로딩 중...</td></tr>`;
        }

        try {
            const res = await apiFetch(`/api/websites/${currentSelectedWebsiteId}/logs`);
            const data = await res.json();
            tbody.innerHTML = '';
            if (!data.logs || data.logs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 30px; color: var(--text-secondary);">수집된 로그 데이터가 없습니다.</td></tr>`;
                return;
            }
            data.logs.forEach((log, index) => {
                const tr = document.createElement('tr');
                const truncatedUrl = log.url.length > 50 ? log.url.substring(0, 50) + "..." : log.url;
                const timeStr = log.updated_at ? `<div style="font-size:0.75rem; color:var(--text-secondary); margin-top:4px;">🕒 ${log.updated_at}</div>` : '';
                tr.innerHTML = `
                    <td style="padding: 10px 16px; border-bottom: 1px solid var(--border-color);"><span style="color: var(--text-secondary); margin-right: 8px; font-weight: 500;">${index + 1}.</span> <a href="${log.url}" target="_blank" style="color:var(--accent-primary); text-decoration:none;">${truncatedUrl}</a></td>
                    <td style="padding: 10px 16px; border-bottom: 1px solid var(--border-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 250px;" title="${log.title}">${log.title || '-'}${timeStr}</td>
                    <td style="padding: 10px 16px; border-bottom: 1px solid var(--border-color); white-space: nowrap;">${(log.length / 1024).toFixed(1)} KB</td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) {
            console.error(e);
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 20px; color: var(--danger);">오류 발생: 로그를 불러오지 못했습니다.</td></tr>`;
        }
    };

    window.viewWebsiteText = async function (docId, url) {
        document.getElementById('website-viewer-content').innerHTML = `로딩 중...`;
        const linkElem = document.getElementById('modal-website-original-link');
        if (linkElem) linkElem.href = url;
        document.getElementById('modal-website-viewer').classList.add('active');
        try {
            const res = await apiFetch(`/api/documents/${docId}/text`);
            const data = await res.json();
            if (data.text) {
                let cleanedText = data.text.split('\n')
                    .map(line => line.trimStart())
                    .filter(line => line.length > 0)
                    .join('\n\n');
                document.getElementById('website-viewer-content').innerHTML = window.marked.parse(cleanedText);
            }
        } catch (e) { console.error(e); }
    };

    window.recrawlWebsite = async function (docId) {
        const doc = websiteDocsCache.find(d => d.id === docId);
        if (!doc) return;

        Swal.fire({
            title: '재크롤링 옵션 변경',
            html: `
                <div style="text-align: left; font-size: 0.95rem;">
                    <p style="margin-bottom: 15px; color: var(--text-secondary);">설정을 변경한 후 다시 수집을 진행할 수 있습니다.</p>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="display: flex; align-items: center; gap: 8px; font-weight: 500; cursor: pointer; color: var(--danger);">
                            <input type="checkbox" id="swal-clear-existing" style="width: 18px; height: 18px;">
                            기존 크롤링 데이터 삭제 (체크 시 기존 데이터 통째로 삭제 후 재수집)
                        </label>
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="font-weight: 500; display: block; margin-bottom: 6px;">크롤링 방식</label>
                        <select id="swal-crawl-mode" style="width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">
                            <option value="spa">SPA (동적 페이지 클릭 형 탐색)</option>
                            <option value="static">전통적인 방식 (정적 JSP/HTML 탐색)</option>
                        </select>
                    </div>

                    <div style="margin-bottom: 15px;">
                        <label style="font-weight: 500; display: block; margin-bottom: 6px;">탐색 순서 전략</label>
                        <select id="swal-crawl-strategy" style="width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">
                            <option value="bfs">너비 우선 탐색 (BFS - 표준 넓게 퍼짐)</option>
                            <option value="dfs">깊이 우선 탐색 (DFS - 카테고리 깊게 파고들기)</option>
                        </select>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                        <div>
                            <label style="font-weight: 500; display: block; margin-bottom: 6px;">최대 경로 깊이</label>
                            <input type="number" id="swal-crawl-depth" value="3" min="1" max="99" style="width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">
                        </div>
                        <div>
                            <label style="font-weight: 500; display: block; margin-bottom: 6px;">최대 페이지 수</label>
                            <input type="number" id="swal-crawl-pages" value="50" min="1" max="1000" style="width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">
                        </div>
                    </div>

                    <div style="margin-bottom: 10px;">
                        <label style="display: flex; align-items: center; gap: 8px; font-weight: 500; cursor: pointer;">
                            <input type="checkbox" id="swal-restrict-path" checked style="width: 18px; height: 18px;">
                            입력 링크 하위(게시판)로만 탐색 제한 (외부 이탈 방지)
                        </label>
                    </div>
                    <div id="swal-ai-extract-wrapper" style="margin-bottom: 20px; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; background: rgba(var(--accent-rgb), 0.03); display: none;">
                        <div style="padding: 10px 15px; border-bottom: 1px solid var(--border-color);">
                            <label style="display: flex; align-items: center; gap: 8px; font-weight: 500; cursor: pointer; color: var(--accent);">
                                <input type="checkbox" id="swal-crawl-use-ai" style="width: 18px; height: 18px;">
                                ✨ AI 의미론적 링크 추출 (Gemini)
                            </label>
                        </div>
                        <div id="swal-ai-prompt-container" style="padding: 15px; display: none;">
                            <label style="font-weight: 500; display: block; margin-bottom: 6px;">프롬프트 입력</label>
                            <textarea id="swal-crawl-ai-prompt" style="width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); height: 80px; resize: vertical;"></textarea>
                        </div>
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '재크롤링 시작',
            cancelButtonText: '취소',
            confirmButtonColor: 'var(--accent-primary)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            customClass: {
                popup: 'swal-custom-popup',
                title: 'swal-custom-title'
            },
            didOpen: () => {
                const swalAiCb = document.getElementById('swal-crawl-use-ai');
                const swalAiCont = document.getElementById('swal-ai-prompt-container');
                const swalModeSelect = document.getElementById('swal-crawl-mode');
                const swalAiWrapper = document.getElementById('swal-ai-extract-wrapper');
                const swalRestrictCb = document.getElementById('swal-restrict-path');

                try {
                    let savedOptions = doc.crawl_options || {};
                    if (Object.keys(savedOptions).length === 0) {
                        // For old documents prior to the patch, use defaults instead of global leak
                        savedOptions = {
                            crawl_type: 'spa',
                            strategy: 'bfs',
                            max_depth: 3,
                            max_pages: 50,
                            restrict_path: false,
                            use_ai_extraction: false,
                            ai_extraction_prompt: '',
                            clear_existing: false
                        };
                    }
                    if (savedOptions.crawl_type) swalModeSelect.value = savedOptions.crawl_type;
                    if (savedOptions.strategy) document.getElementById('swal-crawl-strategy').value = savedOptions.strategy;
                    if (savedOptions.max_depth) document.getElementById('swal-crawl-depth').value = savedOptions.max_depth;
                    if (savedOptions.max_pages) document.getElementById('swal-crawl-pages').value = savedOptions.max_pages;
                    if (savedOptions.restrict_path !== undefined) swalRestrictCb.checked = savedOptions.restrict_path;
                    if (savedOptions.use_ai_extraction !== undefined && swalAiCb) swalAiCb.checked = savedOptions.use_ai_extraction;
                    if (savedOptions.ai_extraction_prompt && document.getElementById('swal-crawl-ai-prompt')) document.getElementById('swal-crawl-ai-prompt').value = savedOptions.ai_extraction_prompt;
                    if (savedOptions.clear_existing !== undefined) {
                        // 기본적으로 비활성화되도록 수정: 기존 옵션이 존재하더라도 재크롤링 시에는 덮어쓰기 방지를 위해 무조건 false로 초기화
                        const cancelCb = document.getElementById('swal-clear-existing');
                        if (cancelCb) cancelCb.checked = false;
                    }
                } catch (e) {}

                if (swalAiCb) {
                    swalAiCb.addEventListener('change', (e) => {
                        swalAiCont.style.display = e.target.checked ? 'block' : 'none';
                        if (swalRestrictCb) {
                            if (e.target.checked) {
                                swalRestrictCb.checked = false;
                                swalRestrictCb.disabled = true;
                            } else {
                                swalRestrictCb.disabled = false;
                            }
                        }
                    });
                }

                if (swalModeSelect && swalAiWrapper) {
                    const toggleSwalAi = () => {
                        if (swalModeSelect.value === 'static') {
                            swalAiWrapper.style.display = 'block';
                        } else {
                            swalAiWrapper.style.display = 'none';
                            if (swalAiCb) {
                                swalAiCb.checked = false;
                                swalAiCb.dispatchEvent(new Event('change'));
                            }
                            if (swalAiCont) swalAiCont.style.display = 'none';
                        }
                    };
                    swalModeSelect.addEventListener('change', toggleSwalAi);
                    toggleSwalAi();
                }
                if (swalAiCb) swalAiCb.dispatchEvent(new Event('change'));
            },
            preConfirm: () => {
                const options = {
                    crawl_type: document.getElementById('swal-crawl-mode').value,
                    strategy: document.getElementById('swal-crawl-strategy').value,
                    max_depth: parseInt(document.getElementById('swal-crawl-depth').value) || 3,
                    max_pages: parseInt(document.getElementById('swal-crawl-pages').value) || 50,
                    restrict_path: document.getElementById('swal-restrict-path').checked,
                    use_ai_extraction: document.getElementById('swal-crawl-use-ai') ? document.getElementById('swal-crawl-use-ai').checked : false,
                    ai_extraction_prompt: document.getElementById('swal-crawl-ai-prompt') ? document.getElementById('swal-crawl-ai-prompt').value : '',
                    clear_existing: document.getElementById('swal-clear-existing').checked
                };
                try {
                    localStorage.setItem('rag_crawl_options', JSON.stringify({
                        crawl_type: options.crawl_type,
                        strategy: options.strategy,
                        max_depth: options.max_depth,
                        max_pages: options.max_pages,
                        restrict_path: options.restrict_path,
                        use_ai_extraction: options.use_ai_extraction,
                        ai_extraction_prompt: options.ai_extraction_prompt
                    }));
                } catch (e) {}
                return options;
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const res = await apiFetch(`/api/websites/${docId}/recrawl`, { 
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(result.value)
                    });
                    if (res.ok) { 
                        window.showToast('새로운 옵션으로 재크롤링이 시작되었습니다.', 'success'); 
                        
                        const docIndex = websiteDocsCache.findIndex(d => d.id === docId);
                        if (docIndex !== -1) {
                            websiteDocsCache[docIndex].status = 'processing';
                            websiteDocsCache[docIndex].progress = '재크롤링 시작 대기 중...';
                            websiteDocsCache[docIndex].progress_percent = 0;
                        }
                        
                        const tbody = document.getElementById('inline-crawl-logs');
                        if (tbody) {
                            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 20px;">재크롤링 시작 중...</td></tr>`;
                            window._lastLogFetchStatus = 'processing';
                        }
                        
                        window.selectWebsite(docId, true);
                        loadWebsiteList(); 
                    } else {
                        const err = await res.json();
                        alert(`🚨 요청 실패: ${err.error || '알 수 없는 오류'}`);
                    }
                } catch (e) { console.error(e); }
            }
        });
    };

    window.stopWebsiteCrawl = async function (docId) {
        window.showConfirmDialog("크롤링 중단", "현재 진행 중인 크롤링을 중단하시겠습니까?", async () => {
            try {
                const res = await apiFetch(`/api/websites/${docId}/stop`, { method: 'POST' });
                if (res.ok) { window.showToast('크롤링이 중단되었습니다.', 'warning'); loadWebsiteList(); }
            } catch (e) { console.error(e); }
        });
    };

    window.deleteWebsite = async function (docId, docName) {
        window.showConfirmDialog("웹사이트 삭제", `'${docName}' 웹사이트 기록과 문서를 완전히 삭제하시겠습니까?`, async () => {
            try {
                const res = await apiFetch(`/api/documents/${docId}`, { method: 'DELETE' });
                if (res.ok) {
                    window.showToast('삭제 완료', 'success');
                    if (currentSelectedWebsiteId === docId) {
                        window.selectWebsite(null, true);
                    }
                    loadWebsiteList();
                }
            } catch (e) { console.error(e); }
        });
    };

    document.getElementById('btn-close-crawl-log')?.addEventListener('click', () => { document.getElementById('modal-crawl-log').classList.remove('active'); });
    document.getElementById('btn-close-website-viewer')?.addEventListener('click', () => { document.getElementById('modal-website-viewer').classList.remove('active'); });
    document.getElementById('btn-website-viewer-close')?.addEventListener('click', () => { document.getElementById('modal-website-viewer').classList.remove('active'); });


// Bulk Actions Logic
function updateBulkActionBar() {
    const bar = document.getElementById('bulk-action-bar');
    const countSpan = document.getElementById('selected-docs-count');
    if (!bar || !countSpan) return;
    
    if (window.selectedDocs.size > 0) {
        bar.style.display = 'flex';
        countSpan.textContent = window.selectedDocs.size;
    } else {
        bar.style.display = 'none';
        countSpan.textContent = '0';
    }
}

    const selectAllCheckbox = document.getElementById('docs-select-all');

    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            if (!docsList) return;
            const checkboxes = docsList.querySelectorAll('.doc-select-checkbox');
            checkboxes.forEach(chk => {
                if (!chk.disabled) {
                    chk.checked = isChecked;
                    const docId = chk.getAttribute('data-doc');
                    if (isChecked) window.selectedDocs.add(docId);
                    else window.selectedDocs.delete(docId);
                }
            });
            updateBulkActionBar();
        });
    }

    if (docsList) {
        docsList.addEventListener('change', (e) => {
            if (e.target.classList.contains('doc-select-checkbox')) {
                const docId = e.target.getAttribute('data-doc');
                if (e.target.checked) {
                    window.selectedDocs.add(docId);
                } else {
                    window.selectedDocs.delete(docId);
                    if (selectAllCheckbox) selectAllCheckbox.checked = false;
                }
                updateBulkActionBar();
            }
        });
    }

    const btnBulkDelete = document.getElementById('btn-bulk-delete');
    if (btnBulkDelete) {
        btnBulkDelete.addEventListener('click', async () => {
            if (window.selectedDocs.size === 0) return;
            const confirmed = await window.showConfirm(`선택한 ${window.selectedDocs.size}개의 문서를 정말 삭제하시겠습니까?`, '일괄 삭제', '삭제', '취소');
            if (!confirmed) return;
            
            let successCount = 0;
            let failCount = 0;
            const docIds = Array.from(window.selectedDocs);
            
            // Sequential processing to avoid overloading the server
            for (const docId of docIds) {
                try {
                    const res = await apiFetch('/api/documents/' + docId, { method: 'DELETE' });
                    if (res.ok) successCount++;
                    else failCount++;
                } catch (e) {
                    failCount++;
                }
            }
            
            window.showToast(`삭제 완료 (${successCount}개 성공, ${failCount}개 실패)`, successCount > 0 ? 'success' : 'error');
            window.selectedDocs.clear();
            updateBulkActionBar();
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            const refreshRes = await apiFetch('/api/documents');
            if (refreshRes.ok) {
                const data = await refreshRes.json();
                updateDocsList(data);
                window.lastDocsDataString = JSON.stringify(data);
            }
        });
    }

    const btnBulkReindex = document.getElementById('btn-bulk-reindex');
    if (btnBulkReindex) {
        btnBulkReindex.addEventListener('click', async () => {
            if (window.selectedDocs.size === 0) return;
            const confirmed = await window.showConfirm(`선택한 ${window.selectedDocs.size}개의 문서를 재인덱싱하시겠습니까? (웹사이트 및 오류 문서는 무시됩니다)`, '일괄 재인덱싱', '실행', '취소');
            if (!confirmed) return;
            
            let successCount = 0;
            let failCount = 0;
            const docIds = Array.from(window.selectedDocs);
            
            for (const docId of docIds) {
                try {
                    const res = await apiFetch('/api/documents/' + docId + '/reindex', { method: 'POST' });
                    if (res.ok) successCount++;
                    else failCount++;
                } catch (e) {
                    failCount++;
                }
            }
            
            window.showToast(`재인덱싱 요청 완료 (${successCount}개 성공, ${failCount}개 실패)`, successCount > 0 ? 'success' : 'error');
            const refreshRes = await apiFetch('/api/documents');
            if (refreshRes.ok) {
                const data = await refreshRes.json();
                updateDocsList(data);
                window.lastDocsDataString = JSON.stringify(data);
            }
        });
    }

    const btnBulkStop = document.getElementById('btn-bulk-stop');
    if (btnBulkStop) {
        btnBulkStop.addEventListener('click', async () => {
            if (window.selectedDocs.size === 0) return;
            const confirmed = await window.showConfirm(`선택한 ${window.selectedDocs.size}개의 문서 처리를 중지하시겠습니까?`, '일괄 중지', '중지', '취소');
            if (!confirmed) return;
            
            let successCount = 0;
            let failCount = 0;
            const docIds = Array.from(window.selectedDocs);
            
            for (const docId of docIds) {
                try {
                    const res = await apiFetch('/api/documents/' + docId + '/stop', { method: 'POST' });
                    if (res.ok) successCount++;
                    else failCount++;
                } catch (e) {
                    failCount++;
                }
            }
            
            window.showToast(`중지 요청 완료 (${successCount}개 성공, ${failCount}개 실패)`, successCount > 0 ? 'success' : 'error');
            const refreshRes = await apiFetch('/api/documents');
            if (refreshRes.ok) {
                const data = await refreshRes.json();
                updateDocsList(data);
                window.lastDocsDataString = JSON.stringify(data);
            }
        });
    }
});

// --- Selected Document Context Management ---
window.selectedSearchDocs = new Map();

window.toggleSearchDocSelection = function (btn) {
    const docId = btn.getAttribute('data-doc-id');
    let docName = btn.getAttribute('data-doc-name');

    // Runtime lookup for older DOM buttons that might just have the ID
    if (!docName || docName === docId) {
        const docInfo = window.allDocuments ? window.allDocuments.find(d => d.id === docId) : null;
        if (docInfo && docInfo.name) docName = docInfo.name;
    }

    if (window.selectedSearchDocs.has(docId)) {
        window.selectedSearchDocs.delete(docId);
    } else {
        window.selectedSearchDocs.set(docId, docName);
    }

    window.renderSelectedDocsPanel();
    window.updateDocSelectionButtons();
};

window.renderSelectedDocsPanel = function () {
    const panel = document.getElementById('selected-docs-panel');
    const container = document.getElementById('selected-docs-list');
    const countSpan = document.getElementById('selected-docs-count');

    if (!panel || !container || !countSpan) return;

    if (window.selectedSearchDocs.size === 0) {
        panel.style.setProperty('display', 'none', 'important');
        return;
    }

    panel.style.setProperty('display', 'flex', 'important');
    countSpan.textContent = window.selectedSearchDocs.size;

    container.innerHTML = '';
    window.selectedSearchDocs.forEach((name, id) => {
        let shortName = name;
        if (shortName.length > 18) {
            shortName = shortName.substring(0, 18) + '...';
        }

        const chip = document.createElement('div');
        chip.className = 'selected-doc-chip';
        chip.innerHTML = `
            <span style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${name.replace(/"/g, '&quot;')}">${shortName.replace(/"/g, '&quot;')}</span>
            <button class="btn-remove-doc" data-doc-id="${id}" title="이 문서 선택 해제">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        `;
        container.appendChild(chip);
    });
};

window.updateDocSelectionButtons = function () {
    // Legacy buttons
    document.querySelectorAll('.btn-select-search-doc').forEach(btn => {
        const docId = btn.getAttribute('data-doc-id');
        if (window.selectedSearchDocs.has(docId)) {
            btn.classList.add('selected');
            btn.innerHTML = '✅ 검색 문서로 선택됨';
        } else {
            btn.classList.remove('selected');
            btn.innerHTML = '📄 이 문서를 질의 대상으로 선택';
        }
    });
    // Checkboxes
    document.querySelectorAll('.doc-search-checkbox').forEach(cb => {
        const docId = cb.getAttribute('data-doc-id');
        cb.checked = window.selectedSearchDocs.has(docId);
    });
};

document.addEventListener('click', (e) => {
    // Select document button from chat
    const selectBtn = e.target.closest('.btn-select-search-doc');
    if (selectBtn) {
        window.toggleSearchDocSelection(selectBtn);
        return;
    }

    // Select document checkbox from chat
    if (e.target.classList.contains('doc-search-checkbox')) {
        window.toggleSearchDocSelection(e.target);
        return;
    }

    // Remove individual doc from panel
    const removeBtn = e.target.closest('.btn-remove-doc');
    if (removeBtn) {
        const docId = removeBtn.getAttribute('data-doc-id');
        window.selectedSearchDocs.delete(docId);
        window.renderSelectedDocsPanel();
        window.updateDocSelectionButtons();
        return;
    }

    // Toggle collapse/expand of panel
    const togglePanelBtn = e.target.closest('#btn-toggle-selected-docs');
    if (togglePanelBtn) {
        const listDiv = document.getElementById('selected-docs-list');
        const icon = togglePanelBtn.querySelector('svg');
        if (listDiv.style.maxHeight === '0px') {
            listDiv.style.maxHeight = '150px';
            icon.style.transform = 'rotate(0deg)';
        } else {
            listDiv.style.maxHeight = '0px';
            icon.style.transform = 'rotate(180deg)';
        }
    }
});


// 모달 외부 영역 클릭 시 닫기
document.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
});

// Generic Alert Dialog
window.showAlertDialog = function (title, message) {
    document.getElementById('modal-confirm-title').innerText = title;
    document.getElementById('modal-confirm-message').innerText = message;
    const modal = document.getElementById('modal-confirm');

    // Cleanup old event listeners
    const btnCancel = document.getElementById('btn-cancel-confirm');
    const btnOk = document.getElementById('btn-ok-confirm');
    const btnClose = document.getElementById('btn-close-confirm');

    // Temporarily hide cancel button for alerts
    btnCancel.style.display = 'none';

    const newBtnOk = btnOk.cloneNode(true);
    const newBtnClose = btnClose.cloneNode(true);

    btnOk.parentNode.replaceChild(newBtnOk, btnOk);
    btnClose.parentNode.replaceChild(newBtnClose, btnClose);

    const closeModal = () => {
        modal.classList.remove('active');
        // Restore for next confirm dialog use
        btnCancel.style.display = '';
    };

    newBtnClose.addEventListener('click', closeModal);
    newBtnOk.addEventListener('click', closeModal);

    modal.classList.add('active');
};

// Generic Confirm Dialog
window.showConfirmDialog = function (title, message, onConfirm) {
    document.getElementById('modal-confirm-title').innerText = title;
    document.getElementById('modal-confirm-message').innerText = message;
    const modal = document.getElementById('modal-confirm');

    // Cleanup old event listeners
    const btnCancel = document.getElementById('btn-cancel-confirm');
    const btnOk = document.getElementById('btn-ok-confirm');
    const btnClose = document.getElementById('btn-close-confirm');

    const newBtnCancel = btnCancel.cloneNode(true);
    const newBtnOk = btnOk.cloneNode(true);
    const newBtnClose = btnClose.cloneNode(true);

    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
    btnOk.parentNode.replaceChild(newBtnOk, btnOk);
    btnClose.parentNode.replaceChild(newBtnClose, btnClose);

    const closeModal = () => modal.classList.remove('active');

    newBtnCancel.addEventListener('click', closeModal);
    newBtnClose.addEventListener('click', closeModal);

    newBtnOk.addEventListener('click', () => {
        closeModal();
        if (onConfirm) onConfirm();
    });

    modal.classList.add('active');
};

// PWA Mobile App Exit Handling
document.addEventListener('DOMContentLoaded', () => {
    // Only apply for mobile devices
    if (window.matchMedia('(max-width: 768px)').matches) {
        // Push an initial state into the history stack so the first "back" can be caught
        window.history.pushState({ pwaState: 'home' }, '', window.location.href);

        window.addEventListener('popstate', function (e) {
            // Find any active full-screen modals we might want to close (generic check)
            const activeModals = document.querySelectorAll('.modal-overlay.active, .modal.active, #pdf-viewer-container');
            let closedAnyModal = false;

            activeModals.forEach(m => {
                // Don't count the exit modal itself
                if (m.id === 'modal-app-exit') return;

                // Close standard modals
                if (m.classList.contains('active')) {
                    m.classList.remove('active');
                    closedAnyModal = true;
                }

                // If it's a dynamically injected pdf-viewer-container that blocks screen
                if (m.id === 'pdf-viewer-container') {
                    m.remove();
                    closedAnyModal = true;
                }

                // If the modal has a close button, simulate a click for cleanup
                const btnClose = m.querySelector('.btn-close');
                if (btnClose && m.style.display !== 'none') {
                    try { btnClose.click(); } catch (err) { }
                }
            });

            if (closedAnyModal) {
                // Re-push state so the next back button can either close another UI element or exit app
                window.history.pushState({ pwaState: 'home' }, '', window.location.href);
                return;
            }

            // If no modals were active, display the exit confirmation modal
            const exitModal = document.getElementById('modal-app-exit');
            if (exitModal) {
                exitModal.classList.add('active');
            }
        });

        const btnCancel = document.getElementById('btn-app-exit-cancel');
        const btnConfirm = document.getElementById('btn-app-exit-confirm');

        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                const exitModal = document.getElementById('modal-app-exit');
                if (exitModal) exitModal.classList.remove('active');

                // User cancelled exit, so we must re-push the state to catch the NEXT back button press
                window.history.pushState({ pwaState: 'home' }, '', window.location.href);
            });
        }

        if (btnConfirm) {
            btnConfirm.addEventListener('click', () => {
                // 1. Close the modal dialog visually
                const exitModal = document.getElementById('modal-app-exit');
                if (exitModal) exitModal.classList.remove('active');

                // 2. Attempt to cleanly exit or navigate away
                if (navigator.app && navigator.app.exitApp) {
                    navigator.app.exitApp();
                } else {
                    // Try to send an Android HOME intent to gracefully background the PWA
                    window.location.href = "intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.HOME;end";

                    // Hack for mobile webview / PWA closing
                    window.open('', '_self', '');
                    try { window.close(); } catch (e) { }

                    // Fallback 1: go deep back in history to exit scope
                    if (window.history.length > 2) {
                        setTimeout(() => { window.history.go(-(window.history.length - 1)); }, 100);
                    }

                    // Fallback 2: Replace body with a polite closing screen instead of about:blank
                    setTimeout(() => {
                        document.body.innerHTML = '<div style="display:flex; height:100vh; width:100vw; align-items:center; justify-content:center; background:#0f172a; color:#cbd5e1; font-family:sans-serif; flex-direction:column; gap:16px; text-align:center; padding: 24px; box-sizing:border-box;"><h2>이용해 주셔서 감사합니다.</h2><p>이제 홈 화면으로 돌아가시거나,<br>위로 스와이프하여 앱을 종료하실 수 있습니다.</p></div>';
                    }, 500);
                }
            });
        }
    }

    const btnChatFilterToggle = document.getElementById('btn-chat-filter-toggle');
    const chatFilterArea = document.getElementById('chat-filter-area');
    const chatFilterToggleIcon = document.querySelector('.filter-toggle-icon');

    if (btnChatFilterToggle && chatFilterArea) {
        btnChatFilterToggle.addEventListener('click', () => {
            chatFilterArea.classList.toggle('expanded');
            if (chatFilterToggleIcon) {
                chatFilterToggleIcon.classList.toggle('open');
            }
        });
    }

    // ====== FLOATING NEW CHAT BUTTON DRAG LOGIC ======
    const fabButton = document.getElementById('floating-new-chat-btn');
    if (fabButton) {
        let isDragging = false;
        let hasMoved = false;
        let startY, startTop;

        const getEventY = (e) => {
            if (e.touches && e.touches.length > 0) return e.touches[0].clientY;
            if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientY;
            return e.clientY;
        };

        const onDragStart = (e) => {
            if (e.type === 'mousedown' && e.button !== 0) return; // Only left click
            isDragging = true;
            hasMoved = false;
            fabButton.style.transition = 'none';
            fabButton.classList.add('dragging');
            document.body.style.userSelect = 'none';
            startY = getEventY(e);

            const rect = fabButton.getBoundingClientRect();
            startTop = rect.top + (rect.height / 2);
            fabButton.style.top = startTop + "px";
            // Important: Remove the CSS translateY so absolute px works cleanly from now on
            fabButton.style.transform = 'translateY(-50%) scale(1.05)';
        };

        const onDragMove = (e) => {
            if (!isDragging) return;
            const currentY = getEventY(e);
            const deltaY = currentY - startY;
            if (Math.abs(deltaY) > 5) hasMoved = true;

            let newTop = startTop + deltaY;

            const fabHeight = fabButton.offsetHeight;
            const padding = 20;
            if (newTop < padding + fabHeight / 2) newTop = padding + fabHeight / 2;
            if (newTop > window.innerHeight - padding - fabHeight / 2) newTop = window.innerHeight - padding - fabHeight / 2;

            fabButton.style.top = newTop + "px";
            if (e.cancelable) e.preventDefault();
        };

        const onDragEnd = (e) => {
            if (!isDragging) return;
            isDragging = false;
            fabButton.style.transition = '';
            fabButton.classList.remove('dragging');
            fabButton.style.transform = 'translateY(-50%) scale(1)';
            document.body.style.userSelect = '';
        };

        const onFabClick = (e) => {
            if (hasMoved) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (window.handleNewChatClick) {
                window.handleNewChatClick(e);
            }
        };

        fabButton.addEventListener('mousedown', onDragStart);
        document.addEventListener('mousemove', onDragMove, { passive: false });
        document.addEventListener('mouseup', onDragEnd);

        fabButton.addEventListener('touchstart', onDragStart, { passive: false });
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('touchend', onDragEnd);

        fabButton.addEventListener('click', onFabClick);
    }


});
