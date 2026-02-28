# Privacy-First AI Digital Hygiene Companion 🛡️🧠

A Browser Extension for First-Year Students to Learn Safe Online Behavior through Gamification and Guided Recovery.

## 1. Project Overview
The Privacy-First AI Digital Hygiene Companion is a browser extension designed to help first-year students practice safe digital behavior while browsing emails and websites. The system focuses on two core ideas: learning by doing through gamification, and reducing panic during mistakes through guided recovery.

## 2. Problem Statement
New internet users often fall victim to phishing, suspicious links, or credential theft due to lack of experience. Existing tools either block content silently or overwhelm users with technical warnings, failing to teach safe behavior or help users recover calmly after mistakes.

## 3. Proposed Solution
This solution introduces a privacy-first browser extension that provides contextual risk awareness, gamified learning through XP and badges, and a unique 'I Think I Messed Up' panic button that guides users step-by-step after a mistake.

## 4. Core Features
*   **Risk Status Indicator:** Shows low, medium, or high risk while browsing emails or websites.
*   **Digital Hygiene XP System:** Users earn XP for safe actions such as avoiding suspicious links or reporting emails.
*   **Badges and Levels:** Visual rewards like 'Phish Spotter' or 'Password Pro' to reinforce learning.
*   **Panic Button ('I Think I Messed Up'):** Allows users to instantly get guided recovery steps after a mistake.
*   **Privacy-First Design:** No user browsing data is stored on cloud servers.

## 5. Technology Stack
*   **Frontend:** React, TypeScript, Tailwind CSS
*   **Browser APIs:** Chrome Extension Manifest v3, Storage API, Active Tab API
*   **Backend (Optional):** FastAPI (Python) for security logic and risk scoring
*   **AI & Detection:** Lightweight ML models, heuristic-based URL and content analysis
*   **Storage:** Browser local storage for XP, badges, and preferences

## 6. Working Logic
1.  The user browses an email or website.
2.  The browser extension analyzes visible content and URLs.
3.  Risk indicators are shown if suspicious patterns are detected.
4.  If the user avoids the risk or reports it, XP is awarded.
5.  If a mistake occurs, the user triggers the panic button.
6.  Guided recovery steps are shown to mitigate damage and educate the user.

## 7. System Architecture
The architecture follows a modular, privacy-first design:
*   Browser Extension handles UI, XP logic, and user interaction.
*   On-device risk analysis performs feature extraction.
*   Backend server processes requests without storing user data.
*   AI engine provides explanations and recovery guidance.
*   All gamification data is stored locally in the browser.

## 8. Privacy & Security Considerations
The system avoids collecting personally identifiable information. User behavior data remains on-device. Backend services are stateless and used only for risk scoring or explanation generation.

## 9. Developer Implementation Notes
Developers can extend this prototype by integrating real phishing datasets, adding animated XP rewards, improving AI explanations, and supporting additional browsers. The modular structure allows independent development of UI, detection logic, and backend services.

---

## Getting Started

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) installed on your machine.

### Installation & Build

1.  Clone or download the repository to your local machine:
    ```bash
    git clone <your-repository-url>
    cd ai-hygiene-extension
    ```

2.  Install the necessary dependencies:
    ```bash
    npm install
    ```

3.  Build the extension for production:
    ```bash
    npm run build
    ```
    This command will compile the React code and copy the assets, including the `manifest.json` and `icon.png`, into a new **`dist`** directory.

## Loading the Extension in Chrome

To test the extension, you need to load the compiled `dist` folder into your browser:

1.  Open Chrome and navigate to `chrome://extensions/`.
2.  Enable **Developer mode** using the toggle switch in the top right corner.
3.  Click the **Load unpacked** button in the top left.
4.  Navigate to your `ai-hygiene-extension` project folder.
5.  **Important:** Select the **`dist`** folder inside your project directory (e.g., `Downloads/ai-hygiene-extension/dist`). Do not select the root project folder, or Chrome will not find the `manifest.json` file.
6.  Click **Select Folder**.

## Development

To modify the extension, you can edit the files in the `src/` directory.

> **Note:** Because Chrome extensions require a specific build structure (like the `manifest.json` file pointing to compiled JavaScript), you must run `npm run build` after making changes to see them reflected in the browser. You can then click the "Refresh" icon on the extension's card in `chrome://extensions/` to load the new build.
