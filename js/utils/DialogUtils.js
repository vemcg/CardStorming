// Dialog utility functions for identity and registration

import { debugLog } from './DebugLog.js';

/**
 * Show registration dialog
 * @param {string} message - Custom message to show
 * @returns {Promise<{email, name, initials}>} - User input
 */
export function showRegistrationDialog(message = 'To continue, please register:') {
    return new Promise((resolve, reject) => {
        const modal = document.getElementById('register-modal');
        const messageEl = document.getElementById('register-message');
        const emailInput = document.getElementById('register-email');
        const nameInput = document.getElementById('register-name');
        const initialsInput = document.getElementById('register-initials');
        const errorEl = document.getElementById('register-error');
        const okBtn = document.getElementById('register-ok');
        const cancelBtn = document.getElementById('register-cancel');

        // Set message
        messageEl.textContent = message;

        // Clear previous inputs
        emailInput.value = '';
        nameInput.value = '';
        initialsInput.value = '';
        errorEl.style.display = 'none';
        errorEl.textContent = '';

        // Show modal
        modal.style.display = 'block';
        emailInput.focus();

        // Handle OK
        const handleOk = () => {
            const email = emailInput.value.trim();
            const name = nameInput.value.trim();
            const initials = initialsInput.value.trim().toUpperCase();

            // Validate
            if (!email || !name || !initials) {
                errorEl.textContent = 'All fields are required';
                errorEl.style.display = 'block';
                return;
            }

            if (!email.includes('@')) {
                errorEl.textContent = 'Please enter a valid email address';
                errorEl.style.display = 'block';
                return;
            }

            if (initials.length < 2 || initials.length > 4) {
                errorEl.textContent = 'Initials must be 2-4 characters';
                errorEl.style.display = 'block';
                return;
            }

            cleanup();
            resolve({ email, name, initials });
        };

        // Handle cancel
        const handleCancel = () => {
            cleanup();
            reject(new Error('Registration cancelled'));
        };

        // Cleanup function
        const cleanup = () => {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
        };

        // Add event listeners
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);

        // Enter key submits
        const handleKeyPress = (e) => {
            if (e.key === 'Enter') {
                handleOk();
            }
        };

        emailInput.addEventListener('keypress', handleKeyPress);
        nameInput.addEventListener('keypress', handleKeyPress);
        initialsInput.addEventListener('keypress', handleKeyPress);
    });
}

/**
 * Show identity selection dialog
 * @param {Array} identities - List of available identities [{name, initials, isDefault}]
 * @param {string} title - Dialog title
 * @param {string} message - Dialog message
 * @param {Function} conflictChecker - Optional function to check conflicts: (name, initials) => Promise<{conflict, message}>
 * @returns {Promise<{name, initials, isNew}>} - Selected identity
 */
export function showIdentityDialog(identities, title = 'Select Identity', message = '', conflictChecker = null) {
    return new Promise((resolve, reject) => {
        const modal = document.getElementById('identity-modal');
        const titleEl = document.getElementById('identity-modal-title');
        const messageEl = document.getElementById('identity-modal-message');
        const optionsContainer = document.getElementById('identity-options');
        const otherFields = document.getElementById('identity-other-fields');
        const nameInput = document.getElementById('identity-name');
        const initialsInput = document.getElementById('identity-initials');
        const errorEl = document.getElementById('identity-error');
        const okBtn = document.getElementById('identity-ok');
        const cancelBtn = document.getElementById('identity-cancel');

        // Set title and message
        titleEl.textContent = title;
        messageEl.textContent = message;

        // Clear previous state
        optionsContainer.innerHTML = '';
        otherFields.style.display = 'none';
        nameInput.value = '';
        initialsInput.value = '';
        errorEl.style.display = 'none';
        errorEl.textContent = '';

        let selectedRadio = null;

        // Create radio options
        identities.forEach((identity, index) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'identity-option';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'identity';
            radio.id = `identity-${index}`;
            radio.value = index;

            const label = document.createElement('label');
            label.htmlFor = `identity-${index}`;
            label.textContent = `${identity.name} (${identity.initials})`;
            if (identity.isDefault) {
                label.textContent += ' ⭐';
            }

            optionDiv.appendChild(radio);
            optionDiv.appendChild(label);
            optionsContainer.appendChild(optionDiv);

            // Click on div selects radio
            optionDiv.addEventListener('click', () => {
                radio.checked = true;
                selectedRadio = radio;
                otherFields.style.display = 'none';
                errorEl.style.display = 'none';
            });

            radio.addEventListener('change', () => {
                selectedRadio = radio;
                otherFields.style.display = 'none';
                errorEl.style.display = 'none';
            });

            // Select first option by default
            if (index === 0) {
                radio.checked = true;
                selectedRadio = radio;
            }
        });

        // Add "Other" option
        const otherDiv = document.createElement('div');
        otherDiv.className = 'identity-option';

        const otherRadio = document.createElement('input');
        otherRadio.type = 'radio';
        otherRadio.name = 'identity';
        otherRadio.id = 'identity-other';
        otherRadio.value = 'other';

        const otherLabel = document.createElement('label');
        otherLabel.htmlFor = 'identity-other';
        otherLabel.textContent = 'Other (enter new)';

        otherDiv.appendChild(otherRadio);
        otherDiv.appendChild(otherLabel);
        optionsContainer.appendChild(otherDiv);

        otherDiv.addEventListener('click', () => {
            otherRadio.checked = true;
            selectedRadio = otherRadio;
            otherFields.style.display = 'block';
            errorEl.style.display = 'none';
            nameInput.focus();
        });

        otherRadio.addEventListener('change', () => {
            selectedRadio = otherRadio;
            otherFields.style.display = 'block';
            errorEl.style.display = 'none';
            nameInput.focus();
        });

        // Show modal
        modal.style.display = 'block';

        // Handle OK
        const handleOk = async () => {
            if (!selectedRadio) {
                errorEl.textContent = 'Please select an identity';
                errorEl.style.display = 'block';
                return;
            }

            if (selectedRadio.value === 'other') {
                // Validate new identity
                const name = nameInput.value.trim();
                const initials = initialsInput.value.trim().toUpperCase();

                if (!name || !initials) {
                    errorEl.textContent = 'Name and initials are required';
                    errorEl.style.display = 'block';
                    return;
                }

                if (initials.length < 2 || initials.length > 4) {
                    errorEl.textContent = 'Initials must be 2-4 characters';
                    errorEl.style.display = 'block';
                    return;
                }

                // Check for conflicts if checker provided
                if (conflictChecker) {
                    const conflictResult = await conflictChecker(name, initials);
                    if (conflictResult.conflict) {
                        errorEl.textContent = conflictResult.message || 'This identity conflicts with an existing user';
                        errorEl.style.display = 'block';
                        return;
                    }
                }

                cleanup();
                resolve({ name, initials, isNew: true });
            } else {
                // Use existing identity
                const selectedIdentity = identities[parseInt(selectedRadio.value)];
                cleanup();
                resolve({
                    name: selectedIdentity.name,
                    initials: selectedIdentity.initials,
                    isNew: false
                });
            }
        };

        // Handle cancel
        const handleCancel = () => {
            cleanup();
            reject(new Error('Identity selection cancelled'));
        };

        // Cleanup function
        const cleanup = () => {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
        };

        // Add event listeners
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
    });
}

/**
 * Show a simple confirm dialog
 */
export function showConfirmDialog(message) {
    return new Promise((resolve) => {
        const result = confirm(message);
        resolve(result);
    });
}

/**
 * Show read-only banner
 */
export function showReadOnlyBanner() {
    let banner = document.getElementById('read-only-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'read-only-banner';
        banner.className = 'read-only-banner';
        banner.textContent = 'Read-Only Mode - Register to edit this project';
        document.body.appendChild(banner);
    }
    banner.style.display = 'block';
}

/**
 * Hide read-only banner
 */
export function hideReadOnlyBanner() {
    const banner = document.getElementById('read-only-banner');
    if (banner) {
        banner.style.display = 'none';
    }
}
