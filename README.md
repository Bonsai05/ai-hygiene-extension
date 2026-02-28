# AI Hygiene Companion 🛡️🧠

A Chrome extension designed to monitor and improve your digital security habits. This prototype includes a modern, clean Wireframe UI featuring an XP progress system, achievement badges, real-time risk status indicators, and quick actionable security tips.

## Technologies Used

*   **React 18** for component-driven UI development
*   **TypeScript** for static type checking
*   **Tailwind CSS** & **Radix UI** for styling and accessible primitives
*   **Vite** as a lightning-fast build tool
*   **Lucide React** for beautiful, consistent iconography

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

The extension should now appear in your list of active extensions and be accessible from the Chrome toolbar!

## Development

To modify the extension, you can edit the files in the `src/` directory.

> **Note:** Because Chrome extensions require a specific build structure (like the `manifest.json` file pointing to compiled JavaScript), you must run `npm run build` after making changes to see them reflected in the browser. You can then click the "Refresh" icon on the extension's card in `chrome://extensions/` to load the new build.
