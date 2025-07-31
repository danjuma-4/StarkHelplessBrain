class ChatApp {
    constructor() {
        this.socket = io();
        this.currentUser = null;
        this.currentGroup = 'general';
        this.groups = {};
        this.onlineUsers = new Map();
        this.typingTimeout = null;
        this.isTyping = false;
        this.selectedMessageId = null;
        this.editingMessageId = null;
        this.blockedUsers = new Set();
        this.pinnedMessages = new Set();

        this.initializeElements();
        this.setupEventListeners();
        this.setupSocketListeners();
        this.initializeNotifications();
    }

    initializeElements() {
        // Login elements
        this.loginScreen = document.getElementById('loginScreen');
        this.chatApp = document.getElementById('chatApp');
        this.usernameInput = document.getElementById('usernameInput');
        this.passwordInput = document.getElementById('passwordInput');
        this.joinBtn = document.getElementById('joinBtn');

        // Theme elements
        this.themeToggle = document.getElementById('themeToggle');
        this.chatThemeToggle = document.getElementById('chatThemeToggle');
        this.themeIcon = document.getElementById('themeIcon');
        this.themeText = document.getElementById('themeText');
        this.chatThemeIcon = document.getElementById('chatThemeIcon');

        // Chat elements
        this.messagesContainer = document.getElementById('messagesContainer');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.fileInput = document.getElementById('fileInput');
        this.attachBtn = document.getElementById('attachBtn');
        this.groupsList = document.getElementById('groupsList');
        this.currentGroupName = document.getElementById('currentGroupName');
        this.userAvatar = document.getElementById('userAvatar');
        this.userName = document.getElementById('userName');
        this.onlineUsersContainer = document.getElementById('onlineUsers');
        this.typingIndicator = document.getElementById('typingIndicator');

        // New UI elements
        this.searchToggle = document.getElementById('searchToggle');
        this.searchBar = document.getElementById('searchBar');
        this.searchInput = document.getElementById('searchInput');
        this.searchClear = document.getElementById('searchClear');
        this.chatMenuToggle = document.getElementById('chatMenuToggle');
        this.emojiBtn = document.getElementById('emojiBtn');
        this.emojiPicker = document.getElementById('emojiPicker');
        this.voiceBtn = document.getElementById('voiceBtn');

        // Modal elements
        this.createGroupModal = document.getElementById('createGroupModal');
        this.createGroupBtn = document.getElementById('createGroupBtn');
        this.groupNameInput = document.getElementById('groupNameInput');
        this.cancelGroupBtn = document.getElementById('cancelGroupBtn');
        this.confirmCreateGroupBtn = document.getElementById('confirmCreateGroupBtn');
        this.logoutBtn = document.getElementById('logoutBtn');

        // New modals
        this.chatMenuModal = document.getElementById('chatMenuModal');
        this.userProfileModal = document.getElementById('userProfileModal');
        this.messageContextMenu = document.getElementById('messageContextMenu');
    }

    setupEventListeners() {
        // Login
        this.joinBtn.addEventListener('click', () => this.joinChat());
        this.usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinChat();
        });
        this.passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinChat();
        });

        // Messaging with typing indicators
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        this.messageInput.addEventListener('input', () => this.handleTyping());
        this.messageInput.addEventListener('blur', () => this.stopTyping());

        // File attachment
        this.attachBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

        // Search functionality
        this.searchToggle.addEventListener('click', () => this.toggleSearch());
        this.searchInput.addEventListener('input', (e) => this.searchMessages(e.target.value));
        this.searchClear.addEventListener('click', () => this.clearSearch());

        // Chat menu
        this.chatMenuToggle.addEventListener('click', () => this.showChatMenu());

        // Emoji picker
        this.emojiBtn.addEventListener('click', () => this.toggleEmojiPicker());
        this.setupEmojiPicker();

        // Group management
        this.createGroupBtn.addEventListener('click', () => this.showCreateGroupModal());
        this.cancelGroupBtn.addEventListener('click', () => this.hideCreateGroupModal());
        this.confirmCreateGroupBtn.addEventListener('click', () => this.createGroup());

        // User profile
        this.userAvatar.addEventListener('click', () => this.showUserProfile());
        this.userName.addEventListener('click', () => this.showUserProfile());

        // Logout
        this.logoutBtn.addEventListener('click', () => this.logout());

        // Theme toggle
        this.themeToggle.addEventListener('click', () => this.toggleTheme());
        this.chatThemeToggle.addEventListener('click', () => this.toggleTheme());

        // Context menu for messages
        document.addEventListener('contextmenu', (e) => this.handleContextMenu(e));
        document.addEventListener('click', (e) => this.hideContextMenu(e));

        // Modal close handlers
        this.setupModalHandlers();

        // Initialize theme
        this.initializeTheme();
    }

    setupSocketListeners() {
        // Authentication responses
        this.socket.on('auth_success', (data) => {
            this.showNotification('Welcome back!', data.message, 'success');
        });

        this.socket.on('auth_error', (data) => {
            this.showNotification('Authentication Failed', data.message, 'error');
            // Stay on login screen
            this.chatApp.classList.add('hidden');
            this.loginScreen.classList.remove('hidden');
        });

        this.socket.on('groups_list', (groups) => {
            this.groups = {};
            groups.forEach(group => {
                this.groups[group.id] = group;
            });
            this.updateGroupsList();
        });

        this.socket.on('messages_history', (data) => {
            if (data.groupId === this.currentGroup) {
                this.messagesContainer.innerHTML = '';
                data.messages.forEach(message => this.displayMessage(message));
                this.scrollToBottom();
            }
        });

        this.socket.on('new_message', (message) => {
            if (message.groupId === this.currentGroup) {
                this.displayMessage(message);
                this.scrollToBottom();
                this.markMessageAsRead(message.id);
            } else {
                this.showNotification(`New message in ${this.groups[message.groupId]?.name || 'Unknown'}`, message.message);
            }
        });

        this.socket.on('user_joined', (data) => {
            this.showSystemMessage(`${data.user.username} joined the group`, data.groupId);
            this.updateOnlineUsers();
        });

        this.socket.on('user_left', (data) => {
            this.showSystemMessage(`${data.user.username} left the group`, data.groupId);
            this.updateOnlineUsers();
        });

        this.socket.on('group_created', (data) => {
            this.switchToGroup(data.groupId);
        });

        // Typing indicators
        this.socket.on('typing_start', (data) => {
            if (data.groupId === this.currentGroup) {
                this.showTypingIndicator(data.user.username);
            }
        });

        this.socket.on('typing_stop', (data) => {
            if (data.groupId === this.currentGroup) {
                this.hideTypingIndicator(data.user.username);
            }
        });

        // Online status
        this.socket.on('online_users', (users) => {
            this.onlineUsers.clear();
            users.forEach(user => {
                if (user) this.onlineUsers.set(user.id, user);
            });
            this.updateOnlineUsers();
        });

        this.socket.on('user_status_change', (data) => {
            if (data.user) {
                this.onlineUsers.set(data.userId, data.user);
                this.updateOnlineUsers();
            }
        });

        // Message operations
        this.socket.on('message_edited', (data) => {
            this.updateEditedMessage(data);
        });

        this.socket.on('message_deleted', (data) => {
            this.removeMessage(data.messageId);
        });

        this.socket.on('message_pin_toggled', (data) => {
            this.toggleMessagePin(data.messageId, data.isPinned);
        });

        this.socket.on('message_read', (data) => {
            this.updateReadReceipts(data);
        });

        // Search results
        this.socket.on('search_results', (data) => {
            this.displaySearchResults(data.results);
        });
    }

    initializeNotifications() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    joinChat() {
        const username = this.usernameInput.value.trim();
        const password = this.passwordInput.value.trim();

        if (!username) {
            this.showNotification('Please enter a username', '', 'error');
            return;
        }

        if (!password) {
            this.showNotification('Please enter a password', '', 'error');
            return;
        }

        if (password.length < 4) {
            this.showNotification('Password must be at least 4 characters long', '', 'error');
            return;
        }

        const defaultAvatar = '👤';

        this.currentUser = {
            username: username,
            avatar: defaultAvatar,
            status: 'online',
            statusMessage: ''
        };

        this.userAvatar.textContent = defaultAvatar;
        this.userName.textContent = username;

        this.socket.emit('user_join', {
            username: username,
            password: password,
            avatar: defaultAvatar,
            status: 'online',
            statusMessage: ''
        });

        this.loginScreen.classList.add('hidden');
        this.chatApp.classList.remove('hidden');
    }

    sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message) return;

        if (this.editingMessageId) {
            this.socket.emit('edit_message', {
                messageId: this.editingMessageId,
                newMessage: message,
                groupId: this.currentGroup
            });
            this.cancelEdit();
        } else {
            this.socket.emit('send_message', {
                groupId: this.currentGroup,
                message: message,
                attachment: null
            });
        }

        this.messageInput.value = '';
        this.stopTyping();
    }

    handleTyping() {
        if (!this.isTyping) {
            this.isTyping = true;
            this.socket.emit('typing_start', { groupId: this.currentGroup });
        }

        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.stopTyping();
        }, 3000);
    }

    stopTyping() {
        if (this.isTyping) {
            this.isTyping = false;
            this.socket.emit('typing_stop', { groupId: this.currentGroup });
            clearTimeout(this.typingTimeout);
        }
    }

    showTypingIndicator(username) {
        this.typingIndicator.textContent = `${username} is typing...`;
        this.typingIndicator.classList.remove('hidden');
    }

    hideTypingIndicator(username) {
        this.typingIndicator.classList.add('hidden');
    }

    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Show upload progress
        this.showNotification('Uploading file...', '', 'info');

        const formData = new FormData();
        formData.append('attachment', file);

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const fileData = await response.json();

                this.socket.emit('send_message', {
                    groupId: this.currentGroup,
                    message: '',
                    attachment: fileData
                });

                this.showNotification('File uploaded successfully!', '', 'success');
            } else {
                this.showNotification('File upload failed', '', 'error');
            }
        } catch (error) {
            console.error('Upload error:', error);
            this.showNotification('File upload failed', '', 'error');
        }

        this.fileInput.value = '';
    }

    displayMessage(message) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message');
        messageEl.dataset.messageId = message.id;

        if (message.user.id === this.socket.id) {
            messageEl.classList.add('own-message');
        }

        if (message.isPinned) {
            messageEl.classList.add('pinned');
        }

        const time = new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        let attachmentHtml = '';
        if (message.attachment) {
            const isImage = message.attachment.originalname.match(/\.(jpg|jpeg|png|gif|webp)$/i);
            if (isImage) {
                attachmentHtml = `
                    <div class="attachment image-attachment">
                        <img src="${message.attachment.url}" alt="${message.attachment.originalname}" onclick="window.open('${message.attachment.url}', '_blank')">
                    </div>
                `;
            } else {
                attachmentHtml = `
                    <div class="attachment file-attachment">
                        <a href="${message.attachment.url}" download="${message.attachment.originalname}">
                            📎 ${message.attachment.originalname}
                        </a>
                    </div>
                `;
            }
        }

        const readReceipts = message.readBy ? message.readBy.filter(id => id !== message.user.id).map(id => {
            const user = this.onlineUsers.get(id);
            return user ? `<span class="read-receipt" title="${user.username}">${user.avatar}</span>` : '';
        }).join('') : '';

        messageEl.innerHTML = `
            <div class="message-header">
                <span class="avatar">${message.user.avatar}</span>
                <span class="username">${message.user.username}</span>
                <span class="timestamp">${time}</span>
            </div>
            ${message.message ? `<div class="message-text">${this.escapeHtml(message.message)}</div>` : ''}
            ${attachmentHtml}
            ${readReceipts ? `<div class="read-receipts">${readReceipts}</div>` : ''}
        `;

        this.messagesContainer.appendChild(messageEl);

        // Auto-mark as read if visible
        if (this.isElementInViewport(messageEl)) {
            this.markMessageAsRead(message.id);
        }
    }

    markMessageAsRead(messageId) {
        this.socket.emit('mark_message_read', {
            messageId: messageId,
            groupId: this.currentGroup
        });
    }

    isElementInViewport(el) {
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
    }

    updateOnlineUsers() {
        this.onlineUsersContainer.innerHTML = '';

        this.onlineUsers.forEach(user => {
            if (user.status !== 'invisible') {
                const userEl = document.createElement('div');
                userEl.classList.add('online-user');

                const statusClass = user.status === 'online' ? '' : user.status;
                userEl.innerHTML = `
                    <span class="status-indicator ${statusClass}"></span>
                    <span class="avatar">${user.avatar}</span>
                    <span class="username">${user.username}</span>
                `;

                this.onlineUsersContainer.appendChild(userEl);
            }
        });
    }

    toggleSearch() {
        this.searchBar.classList.toggle('hidden');
        if (!this.searchBar.classList.contains('hidden')) {
            this.searchInput.focus();
        }
    }

    searchMessages(query) {
        if (query.trim()) {
            this.socket.emit('search_messages', {
                query: query,
                groupId: this.currentGroup
            });
        }
    }

    clearSearch() {
        this.searchInput.value = '';
        this.searchBar.classList.add('hidden');
        // Reload current messages
        this.socket.emit('join_group', { groupId: this.currentGroup });
    }

    toggleEmojiPicker() {
        this.emojiPicker.classList.toggle('hidden');
    }

    setupEmojiPicker() {
        this.emojiPicker.addEventListener('click', (e) => {
            if (e.target.classList.contains('emoji-item')) {
                this.messageInput.value += e.target.textContent;
                this.emojiPicker.classList.add('hidden');
                this.messageInput.focus();
            }
        });
    }

    handleContextMenu(e) {
        const messageEl = e.target.closest('.message');
        if (messageEl && messageEl.classList.contains('own-message')) {
            e.preventDefault();
            this.selectedMessageId = messageEl.dataset.messageId;
            this.showContextMenu(e.clientX, e.clientY);
        }
    }

    showContextMenu(x, y) {
        this.messageContextMenu.style.left = `${x}px`;
        this.messageContextMenu.style.top = `${y}px`;
        this.messageContextMenu.classList.remove('hidden');

        // Add click handlers for context menu options
        this.messageContextMenu.querySelectorAll('.context-option').forEach(option => {
            option.onclick = (e) => {
                const action = e.target.dataset.action;
                this.handleContextAction(action);
                this.hideContextMenu();
            };
        });
    }

    hideContextMenu() {
        this.messageContextMenu.classList.add('hidden');
    }

    handleContextAction(action) {
        switch (action) {
            case 'edit':
                this.editMessage(this.selectedMessageId);
                break;
            case 'delete':
                this.deleteMessage(this.selectedMessageId);
                break;
            case 'pin':
                this.togglePinMessage(this.selectedMessageId);
                break;
            case 'reply':
                this.replyToMessage(this.selectedMessageId);
                break;
        }
    }

    editMessage(messageId) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        const messageText = messageEl.querySelector('.message-text').textContent;
        this.messageInput.value = messageText;
        this.editingMessageId = messageId;
        this.messageInput.focus();
        this.showNotification('Editing message - press Enter to save', '', 'info');
    }

    cancelEdit() {
        this.editingMessageId = null;
        this.messageInput.value = '';
    }

    deleteMessage(messageId) {
        if (confirm('Are you sure you want to delete this message?')) {
            this.socket.emit('delete_message', {
                messageId: messageId,
                groupId: this.currentGroup
            });
        }
    }

    togglePinMessage(messageId) {
        this.socket.emit('toggle_pin_message', {
            messageId: messageId,
            groupId: this.currentGroup
        });
    }

    showNotification(title, message, type = 'info') {
        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
            new Notification(title, {
                body: message,
                icon: '/favicon.ico'
            });
        }

        // In-app notification
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <strong>${title}</strong>
            ${message ? `<br>${message}` : ''}
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    setupModalHandlers() {
        // Chat menu modal
        document.getElementById('closeChatMenuBtn').addEventListener('click', () => {
            this.chatMenuModal.classList.add('hidden');
        });

        // User profile modal
        document.getElementById('cancelProfileBtn').addEventListener('click', () => {
            this.userProfileModal.classList.add('hidden');
        });

        document.getElementById('saveProfileBtn').addEventListener('click', () => {
            this.saveUserProfile();
        });
    }

    showChatMenu() {
        this.chatMenuModal.classList.remove('hidden');
    }

    showUserProfile() {
        this.userProfileModal.classList.remove('hidden');
        // Populate current values
        document.getElementById('profileAvatar').textContent = this.currentUser.avatar;
        document.getElementById('profileStatus').value = this.currentUser.statusMessage || '';
        document.getElementById('statusSelect').value = this.currentUser.status || 'online';
    }

    saveUserProfile() {
        const status = document.getElementById('statusSelect').value;
        const statusMessage = document.getElementById('profileStatus').value;

        this.currentUser.status = status;
        this.currentUser.statusMessage = statusMessage;

        this.socket.emit('update_status', {
            status: status,
            statusMessage: statusMessage
        });

        this.userProfileModal.classList.add('hidden');
        this.showNotification('Profile updated successfully!', '', 'success');
    }

    showSystemMessage(text, groupId) {
        if (groupId !== this.currentGroup) return;

        const messageEl = document.createElement('div');
        messageEl.classList.add('system-message');
        messageEl.textContent = text;
        this.messagesContainer.appendChild(messageEl);
        this.scrollToBottom();
    }

    updateGroupsList() {
        this.groupsList.innerHTML = '';

        Object.values(this.groups).forEach(group => {
            const groupEl = document.createElement('div');
            groupEl.classList.add('group-item');
            if (group.id === this.currentGroup) {
                groupEl.classList.add('active');
            }

            groupEl.innerHTML = `
                <span class="group-name">${group.name}</span>
                <span class="member-count">${group.members.length}</span>
            `;

            groupEl.addEventListener('click', () => this.switchToGroup(group.id));
            this.groupsList.appendChild(groupEl);
        });
    }

    switchToGroup(groupId) {
        if (this.currentGroup !== groupId) {
            this.socket.emit('join_group', { groupId });
            this.currentGroup = groupId;
            this.currentGroupName.textContent = this.groups[groupId]?.name || groupId;
            this.updateGroupsList();
            this.messagesContainer.innerHTML = '';
        }
    }

    showCreateGroupModal() {
        this.createGroupModal.classList.remove('hidden');
        this.groupNameInput.focus();
    }

    hideCreateGroupModal() {
        this.createGroupModal.classList.add('hidden');
        this.groupNameInput.value = '';
    }

    createGroup() {
        const groupName = this.groupNameInput.value.trim();
        if (!groupName) {
            this.showNotification('Please enter a group name', '', 'error');
            return;
        }

        this.socket.emit('create_group', { groupName });
        this.hideCreateGroupModal();
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    initializeTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        this.setTheme(savedTheme);
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        this.setTheme(newTheme);
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);

        const isDark = theme === 'dark';
        if (this.themeIcon) {
            this.themeIcon.textContent = isDark ? '☀️' : '🌙';
        }
        if (this.themeText) {
            this.themeText.textContent = isDark ? 'Light Mode' : 'Dark Mode';
        }
        if (this.chatThemeIcon) {
            this.chatThemeIcon.textContent = isDark ? '☀️' : '🌙';
        }
    }

    logout() {
        this.socket.disconnect();

        this.currentUser = null;
        this.currentGroup = 'general';
        this.groups = {};
        this.onlineUsers.clear();

        this.messagesContainer.innerHTML = '';
        this.groupsList.innerHTML = '';
        this.usernameInput.value = '';
        this.passwordInput.value = '';

        this.chatApp.classList.add('hidden');
        this.loginScreen.classList.remove('hidden');

        this.socket = io();
        this.setupSocketListeners();
    }
}

// Initialize the chat app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});