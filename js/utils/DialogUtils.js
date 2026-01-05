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

        // Stop any ongoing drag operations that might have auto-zoom running
        if (window.appState && window.appState.currentDrag) {
            window.appState.currentDrag.isDragging = false;
            if (window.appState.currentDrag.zoomAnimationFrame) {
                cancelAnimationFrame(window.appState.currentDrag.zoomAnimationFrame);
                window.appState.currentDrag.zoomAnimationFrame = null;
            }
            window.appState.currentDrag = null;
        }

        // Stop wormhole zoom animation if running
        if (window.wormholeZoomAnimationFrame) {
            cancelAnimationFrame(window.wormholeZoomAnimationFrame);
            window.wormholeZoomAnimationFrame = null;
        }

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

        // Stop any ongoing drag operations that might have auto-zoom running
        if (window.appState && window.appState.currentDrag) {
            window.appState.currentDrag.isDragging = false;
            if (window.appState.currentDrag.zoomAnimationFrame) {
                cancelAnimationFrame(window.appState.currentDrag.zoomAnimationFrame);
                window.appState.currentDrag.zoomAnimationFrame = null;
            }
            window.appState.currentDrag = null;
        }

        // Stop wormhole zoom animation if running
        if (window.wormholeZoomAnimationFrame) {
            cancelAnimationFrame(window.wormholeZoomAnimationFrame);
            window.wormholeZoomAnimationFrame = null;
        }

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
 * Pass onRegisterClick callback to handle click
 */
export function showReadOnlyBanner(onRegisterClick) {
    let banner = document.getElementById('read-only-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'read-only-banner';
        banner.className = 'read-only-banner';
        banner.textContent = 'Read-Only Mode - Click here to register and edit this project';
        banner.style.cursor = 'pointer';
        document.body.appendChild(banner);
    }

    // Remove old click handler and add new one
    const newBanner = banner.cloneNode(true);
    banner.parentNode.replaceChild(newBanner, banner);

    if (onRegisterClick) {
        newBanner.addEventListener('click', onRegisterClick);
    }

    newBanner.style.display = 'block';
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

/**
 * Show wormhole naming dialog
 * @returns {Promise<{end1: string, end2: string}>} - Names for both wormhole ends
 */
export function showWormholeNamingDialog() {
    return new Promise((resolve, reject) => {
        // Create modal elements
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'block';

        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';

        const title = document.createElement('h2');
        title.textContent = 'Name Wormhole Ends';

        const end1Label = document.createElement('label');
        end1Label.textContent = 'This End:';
        const end1Input = document.createElement('input');
        end1Input.type = 'text';
        end1Input.placeholder = 'Enter name for this end';
        end1Input.style.marginBottom = '15px';
        end1Input.style.width = '100%';
        end1Input.style.padding = '8px';

        const end2Label = document.createElement('label');
        end2Label.textContent = 'That End:';
        const end2Input = document.createElement('input');
        end2Input.type = 'text';
        end2Input.placeholder = 'Enter name for that end';
        end2Input.style.marginBottom = '15px';
        end2Input.style.width = '100%';
        end2Input.style.padding = '8px';

        const errorEl = document.createElement('div');
        errorEl.style.color = 'red';
        errorEl.style.display = 'none';
        errorEl.style.marginBottom = '10px';

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'modal-buttons';

        const okBtn = document.createElement('button');
        okBtn.textContent = 'OK';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';

        buttonContainer.appendChild(okBtn);
        buttonContainer.appendChild(cancelBtn);

        modalContent.appendChild(title);
        modalContent.appendChild(end1Label);
        modalContent.appendChild(end1Input);
        modalContent.appendChild(end2Label);
        modalContent.appendChild(end2Input);
        modalContent.appendChild(errorEl);
        modalContent.appendChild(buttonContainer);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // Stop any ongoing animations
        if (window.appState && window.appState.currentDrag) {
            window.appState.currentDrag.isDragging = false;
            if (window.appState.currentDrag.zoomAnimationFrame) {
                cancelAnimationFrame(window.appState.currentDrag.zoomAnimationFrame);
                window.appState.currentDrag.zoomAnimationFrame = null;
            }
            window.appState.currentDrag = null;
        }

        if (window.wormholeZoomAnimationFrame) {
            cancelAnimationFrame(window.wormholeZoomAnimationFrame);
            window.wormholeZoomAnimationFrame = null;
        }

        // Focus first input
        end1Input.focus();

        const cleanup = () => {
            modal.remove();
        };

        const handleOk = () => {
            const end1 = end1Input.value.trim();
            const end2 = end2Input.value.trim();

            if (!end1 || !end2) {
                errorEl.textContent = 'Please provide names for both ends';
                errorEl.style.display = 'block';
                return;
            }

            cleanup();
            resolve({ end1, end2 });
        };

        const handleCancel = () => {
            cleanup();
            reject(new Error('Wormhole naming cancelled'));
        };

        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);

        // Enter key submits
        end1Input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                end2Input.focus();
            }
        });

        end2Input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleOk();
            }
        });

        // Escape key cancels
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                handleCancel();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}

/**
 * Show dialog to edit a wormhole's name
 * @param {string} currentName - The current name of the wormhole
 * @returns {Promise<string>} Promise that resolves with the new name or rejects if cancelled
 */
export function showWormholeEditDialog(currentName = '') {
    return new Promise((resolve, reject) => {
        // Create modal elements dynamically
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'block';

        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';

        const title = document.createElement('h2');
        title.textContent = 'Edit Wormhole Name';
        modalContent.appendChild(title);

        const form = document.createElement('form');

        const label = document.createElement('label');
        label.textContent = 'Wormhole Name:';
        label.style.display = 'block';
        label.style.marginBottom = '8px';
        label.style.fontWeight = 'bold';
        form.appendChild(label);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = currentName;
        nameInput.placeholder = 'Enter wormhole name';
        nameInput.style.width = '100%';
        nameInput.style.padding = '8px';
        nameInput.style.marginBottom = '16px';
        nameInput.style.boxSizing = 'border-box';
        form.appendChild(nameInput);

        const errorEl = document.createElement('div');
        errorEl.style.color = 'red';
        errorEl.style.marginBottom = '16px';
        errorEl.style.display = 'none';
        form.appendChild(errorEl);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '8px';
        buttonContainer.style.justifyContent = 'flex-end';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'btn-secondary';
        buttonContainer.appendChild(cancelBtn);

        const okBtn = document.createElement('button');
        okBtn.type = 'submit';
        okBtn.textContent = 'OK';
        okBtn.className = 'btn-primary';
        buttonContainer.appendChild(okBtn);

        form.appendChild(buttonContainer);
        modalContent.appendChild(form);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // Focus the input and select all text
        setTimeout(() => {
            nameInput.focus();
            nameInput.select();
        }, 0);

        const cleanup = () => {
            modal.remove();
        };

        const handleOk = () => {
            const newName = nameInput.value.trim();

            if (!newName) {
                errorEl.textContent = 'Please provide a name';
                errorEl.style.display = 'block';
                return;
            }

            cleanup();
            resolve(newName);
        };

        const handleCancel = () => {
            cleanup();
            reject(new Error('Wormhole edit cancelled'));
        };

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            handleOk();
        });

        cancelBtn.addEventListener('click', handleCancel);

        // Escape key to cancel
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                handleCancel();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}
