const token =
    localStorage.getItem("adminToken");

/* =========================
   LOGIN
========================= */

const loginForm =
    document.getElementById("loginForm");

if (loginForm) {

    loginForm.addEventListener(
        "submit",
        async function (event) {

            event.preventDefault();

            const username =
                document.getElementById("username").value;

            const password =
                document.getElementById("password").value;

            const message =
                document.getElementById("loginMessage");

            try {

                const response =
                    await fetch(
                        "/api/admin/login",
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({
                                username,
                                password
                            })
                        }
                    );

                const data =
                    await response.json();

                if (!response.ok) {
                    throw new Error(data.message);
                }

                localStorage.setItem(
                    "adminToken",
                    data.token
                );

                window.location.href =
                    "/admin/dashboard";

            } catch (error) {

                message.textContent =
                    error.message;
            }
        }
    );
}


/* =========================
   DASHBOARD
========================= */

const participants =
    document.getElementById("participants");

if (participants) {

    if (!token) {
        window.location.href =
            "/admin";
    }

    loadDashboard();

    document
        .getElementById("refresh")
        .addEventListener(
            "click",
            loadDashboard
        );

    document
        .getElementById("logout")
        .addEventListener(
            "click",
            function () {

                localStorage.removeItem(
                    "adminToken"
                );

                window.location.href =
                    "/admin";
            }
        );

    document
        .getElementById("export")
        .addEventListener(
            "click",
            exportCSV
        );
}


async function loadDashboard() {

    try {

        const statsResponse =
            await fetch(
                "/api/admin/stats",
                {
                    headers: {
                        Authorization:
                            `Bearer ${token}`
                    }
                }
            );

        if (statsResponse.status === 401) {
            logout();
            return;
        }

        const stats =
            await statsResponse.json();

        document.getElementById(
            "total"
        ).textContent = stats.total;


        const response =
            await fetch(
                "/api/admin/participants",
                {
                    headers: {
                        Authorization:
                            `Bearer ${token}`
                    }
                }
            );

        if (response.status === 401) {
            logout();
            return;
        }

        const data =
            await response.json();

        participants.innerHTML = "";

        data.forEach((person, index) => {

            const row =
                document.createElement("tr");

            const date =
                new Date(
                    person.created_at
                ).toLocaleString("fr-FR");

            row.innerHTML = `
                <td>${index + 1}</td>

                <td>${escapeHTML(person.nom)}</td>

                <td>${escapeHTML(person.prenom)}</td>

                <td>${person.age}</td>

                <td>${escapeHTML(person.classe)}</td>

                <td>
                    <div class="photo-frame">
                        <img
                            class="photo"
                            alt=""
                            loading="lazy"
                        >
                        <span class="photo-placeholder">Aucune photo</span>
                    </div>
                </td>

                <td>${date}</td>

                <td>
                    <button
                        class="delete"
                        onclick="deleteParticipant(${person.id})"
                    >
                        Supprimer
                    </button>
                </td>
            `;

            participants.appendChild(row);

            const photo = row.querySelector(".photo");
            const placeholder = row.querySelector(".photo-placeholder");

            photo.addEventListener("click", () => {
                if (photo.getAttribute("src")) {
                    openPhotoPreview(photo.src);
                }
            });

            loadPhoto(photo, placeholder, person.id);
        });

    } catch (error) {

        console.error(error);
    }
}


function openPhotoPreview(src) {

    const preview = document.createElement("div");
    preview.className = "photo-preview";
    preview.innerHTML = `
        <button class="photo-preview-close" type="button" aria-label="Fermer">
            ×
        </button>
        <img src="${src}" alt="Photo agrandie">
    `;

    document.body.appendChild(preview);

    const closePreview = () => preview.remove();

    preview.addEventListener("click", event => {
        if (event.target === preview) {
            closePreview();
        }
    });

    preview
        .querySelector(".photo-preview-close")
        .addEventListener("click", closePreview);

    document.addEventListener("keydown", function closeWithEscape(event) {
        if (event.key === "Escape") {
            closePreview();
            document.removeEventListener("keydown", closeWithEscape);
        }
    });
}


async function loadPhoto(image, placeholder, id) {

    try {

        const response = await fetch(
            `/api/admin/photo/${id}`,
            {
                headers: {
                    Authorization:
                        `Bearer ${token}`
                }
            }
        );

        if (!response.ok) {
            image.classList.add("photo-missing");
            placeholder.hidden = false;
            return;
        }

        const blob = await response.blob();
        image.src = URL.createObjectURL(blob);
        image.classList.remove("photo-missing");
        placeholder.hidden = true;

    } catch (error) {

        placeholder.hidden = false;
        console.error("Impossible de charger la photo.", error);
    }
}


async function deleteParticipant(id) {

    const confirmed =
        confirm(
            "Voulez-vous vraiment supprimer cette inscription ?"
        );

    if (!confirmed) {
        return;
    }

    const response = await fetch(
        `/api/admin/participants/${id}`,
        {
            method: "DELETE",
            headers: {
                Authorization:
                    `Bearer ${token}`
            }
        }
    );

    if (response.ok) {
        loadDashboard();
        return;
    }

    const data = await response.json().catch(() => ({}));
    alert(data.message || "La suppression a échoué.");
}


async function exportCSV() {

    const response =
        await fetch(
            "/api/admin/export",
            {
                headers: {
                    Authorization:
                        `Bearer ${token}`
                }
            }
        );

    if (!response.ok) {
        return;
    }

    const blob =
        await response.blob();

    const url =
        URL.createObjectURL(blob);

    const link =
        document.createElement("a");

    link.href = url;
    link.download = "participants.csv";

    link.click();

    URL.revokeObjectURL(url);
}


function logout() {

    localStorage.removeItem(
        "adminToken"
    );

    window.location.href =
        "/admin";
}


function escapeHTML(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}