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
                    <img
                        class="photo"
                        src="/api/admin/photo/${person.id}"
                        alt="Photo"
                    >
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
        });

    } catch (error) {

        console.error(error);
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

    const response =
        await fetch(
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
    }
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