const form =
    document.getElementById("registrationForm");

const button =
    document.getElementById("submitButton");

const message =
    document.getElementById("message");

form.addEventListener("submit", async function (event) {

    event.preventDefault();

    button.disabled = true;
    button.textContent = "Envoi en cours...";

    message.textContent = "";
    message.className = "";

    try {

        const formData =
            new FormData(form);

        const response =
            await fetch(
                "/api/participants",
                {
                    method: "POST",
                    body: formData
                }
            );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.message ||
                "Une erreur est survenue."
            );
        }

        message.textContent =
            "✓ Votre inscription a été enregistrée.";

        message.className = "success";

        form.reset();

    } catch (error) {

        message.textContent =
            error.message;

        message.className = "error";

    } finally {

        button.disabled = false;

        button.textContent =
            "Envoyer mon inscription";
    }
});