const titleInput = document.querySelector("#post-title");
const bodyInput = document.querySelector("#post-body");
const wordCount = document.querySelector("#word-count");
const characterCount = document.querySelector("#character-count");
const readingTime = document.querySelector("#reading-time");
const saveStatus = document.querySelector("#save-status");
const previewDialog = document.querySelector("#preview-dialog");
const toast = document.querySelector("#toast");
const wordFile = document.querySelector("#word-file");
const editorPage = document.querySelector("#editor-page");
const publishedPage = document.querySelector("#published-page");
const authorsPage = document.querySelector("#authors-page");
const readerPage = document.querySelector("#reader-page");
const authorSelect = document.querySelector("#post-author");
const authorForm = document.querySelector("#author-form");
const homePage = document.querySelector("#home-page");
const submissionConfirmation = document.querySelector("#submission-confirmation");
const pendingList = document.querySelector("#pending-list");
const supabaseConfig = window.BEYOND_SURFACE_SUPABASE || {};
const supabaseClient =
  window.supabase && supabaseConfig.url && supabaseConfig.anonKey
    ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey)
    : null;
const ADMIN_USER_ID = (supabaseConfig.adminUserId || "").trim();

const DATABASE_NAME = "draft-blog-writing";
const DEFAULT_AUTHOR = {
  id: "beyond-the-surface",
  name: "Beyond the Surface",
  bio: "Stories, perspectives, and reflections from our community of writers.",
  photo: "",
};
const prompts = [
  "What is something ordinary that felt meaningful this week?",
  "Write about a place that always makes you feel like yourself.",
  "What is a small thing you used to take for granted?",
  "Describe a moment you wish you could step into again.",
];

let saveTimer;
let toastTimer;
let selectedImage;
let publishedDraftId = null;
let selectedAuthorId = DEFAULT_AUTHOR.id;
let editingAuthorId = null;
let editingAuthorPhoto = "";
let authors = [];

function getWordCount(text) {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

function updateStats() {
  const text = bodyInput.innerText;
  const words = getWordCount(text);
  const minutes = Math.max(1, Math.ceil(words / 200));
  document.querySelector("#breadcrumb-title").textContent =
    titleInput.value.trim() || "Write a blog";
  document.querySelector("#selected-author-name").textContent =
    document.querySelector("#submission-name").value.trim() || "Your name";
  wordCount.textContent = `${words} ${words === 1 ? "word" : "words"}`;
  characterCount.textContent = `${text.length} ${
    text.length === 1 ? "character" : "characters"
  }`;
  readingTime.textContent = `${minutes} min read`;
}

function setSaveState(state) {
  saveStatus.classList.toggle("saving", state === "saving");
  saveStatus.classList.toggle("save-error", state === "error");
  saveStatus.querySelector(".save-label").textContent = {
    saving: "Saving...",
    saved: "Saved",
    error: "Save failed",
  }[state];
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 3);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("drafts")) {
        database.createObjectStore("drafts");
      }
      if (!database.objectStoreNames.contains("published")) {
        database.createObjectStore("published");
      }
      if (!database.objectStoreNames.contains("authors")) {
        database.createObjectStore("authors");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAuthors() {
  const database = await openDatabase();
  try {
    const request = database.transaction("authors", "readonly").objectStore("authors").getAll();
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function saveAuthor(author) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("authors", "readwrite");
    transaction.objectStore("authors").put(author, author.id);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function deleteAuthor(authorId) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("authors", "readwrite");
    transaction.objectStore("authors").delete(authorId);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function loadAuthors() {
  let database;
  try {
    database = await openDatabase();
    const transaction = database.transaction("authors", "readwrite");
    const store = transaction.objectStore("authors");
    const request = store.get(DEFAULT_AUTHOR.id);
    request.onsuccess = () => {
      if (!request.result) store.put(DEFAULT_AUTHOR, DEFAULT_AUTHOR.id);
    };
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    database = null;
    await refreshAuthors();
  } catch (error) {
    showToast("Author profiles could not be loaded.");
    console.error("Unable to load author profiles.", error);
  } finally {
    if (database) database.close();
  }
}

function getSelectedAuthor() {
  return authors.find((author) => author.id === (authorSelect.value || selectedAuthorId)) || DEFAULT_AUTHOR;
}

function updateAuthorAvatar(element, author) {
  element.replaceChildren();
  if (author.photo) {
    const photo = document.createElement("img");
    photo.src = author.photo;
    photo.alt = "";
    element.append(photo);
    return;
  }
  element.textContent = author.name.trim().charAt(0).toUpperCase() || "?";
}

function refreshAuthorSelect() {
  const previousId = authorSelect.value || selectedAuthorId;
  authorSelect.replaceChildren();
  authors.forEach((author) => {
    const option = document.createElement("option");
    option.value = author.id;
    option.textContent = author.name;
    authorSelect.append(option);
  });
  selectedAuthorId = authors.some((author) => author.id === previousId)
    ? previousId
    : DEFAULT_AUTHOR.id;
  authorSelect.value = selectedAuthorId;
  document.querySelector("#selected-author-name").textContent = getSelectedAuthor().name;
}

function createAuthorCard(author) {
  const card = document.createElement("article");
  card.className = "author-list-card";
  const avatar = document.createElement("div");
  avatar.className = "author-avatar";
  updateAuthorAvatar(avatar, author);

  const details = document.createElement("div");
  details.className = "author-list-details";
  const name = document.createElement("h2");
  name.textContent = author.name;
  const bio = document.createElement("p");
  bio.textContent = author.bio || "No author introduction added yet.";
  details.append(name, bio);

  const actions = document.createElement("div");
  actions.className = "author-list-actions";
  const editButton = document.createElement("button");
  editButton.className = "button button-quiet";
  editButton.type = "button";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => editAuthor(author));
  actions.append(editButton);

  if (author.id !== DEFAULT_AUTHOR.id) {
    const deleteButton = document.createElement("button");
    deleteButton.className = "button button-quiet";
    deleteButton.type = "button";
    deleteButton.textContent = "Remove";
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm(`Remove ${author.name} from the author list? Existing published stories keep their saved author details.`)) {
        return;
      }
      try {
        await deleteAuthor(author.id);
        await refreshAuthors();
        if (editingAuthorId === author.id) resetAuthorForm();
        saveDraft();
        showToast("Author removed.");
      } catch (error) {
        showToast("That author could not be removed.");
        console.error("Unable to remove author.", error);
      }
    });
    actions.append(deleteButton);
  }

  card.append(avatar, details, actions);
  return card;
}

async function refreshAuthors() {
  authors = await getAuthors();
  authors.sort((first, second) => {
    if (first.id === DEFAULT_AUTHOR.id) return -1;
    if (second.id === DEFAULT_AUTHOR.id) return 1;
    return first.name.localeCompare(second.name);
  });
  refreshAuthorSelect();
  const list = document.querySelector("#authors-list");
  list.replaceChildren(...authors.map(createAuthorCard));
}

function editAuthor(author) {
  editingAuthorId = author.id;
  editingAuthorPhoto = author.photo || "";
  document.querySelector("#author-name").value = author.name;
  document.querySelector("#author-bio").value = author.bio || "";
  document.querySelector("#author-form-heading").textContent = "Edit author";
  document.querySelector("#save-author-button").textContent = "Save changes";
  document.querySelector("#cancel-author-edit").hidden = false;
  authorForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetAuthorForm() {
  authorForm.reset();
  editingAuthorId = null;
  editingAuthorPhoto = "";
  document.querySelector("#author-form-heading").textContent = "Add an author";
  document.querySelector("#save-author-button").textContent = "Add author";
  document.querySelector("#cancel-author-edit").hidden = true;
}

function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function plainTextToHtml(text) {
  const content = document.createElement("div");
  text.split(/\n{2,}/).forEach((paragraph) => {
    const element = document.createElement("p");
    paragraph.split("\n").forEach((line, index) => {
      if (index) element.append(document.createElement("br"));
      element.append(document.createTextNode(line));
    });
    content.append(element);
  });
  return content.innerHTML;
}

async function saveDraft() {
  setSaveState("saving");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    let database;
    try {
      database = await openDatabase();
      const transaction = database.transaction("drafts", "readwrite");
      const body = bodyInput.cloneNode(true);
      body.querySelectorAll(".selected-image").forEach((image) => image.classList.remove("selected-image"));
      transaction.objectStore("drafts").put(
        {
          title: titleInput.value,
          body: body.innerHTML,
          publishedId: publishedDraftId,
          authorId: selectedAuthorId,
        },
        "current",
      );
      transaction.oncomplete = () => setSaveState("saved");
      transaction.onabort = () => {
        setSaveState("error");
        showToast("Your draft could not be saved.");
        console.error("Saving the draft was cancelled.", transaction.error);
      };
    } catch (error) {
      setSaveState("error");
      showToast("Your draft could not be saved in this browser.");
      console.error("Unable to open draft storage.", error);
    } finally {
      if (database) database.close();
    }
  }, 350);
}

async function loadDraft() {
  let database;
  let migrated = false;
  try {
    database = await openDatabase();
    const request = database.transaction("drafts", "readonly").objectStore("drafts").get("current");
    let draft = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (!draft) {
      const oldDraft = localStorage.getItem("draft-blog-writing");
      if (oldDraft) {
        const previousDraft = JSON.parse(oldDraft);
        if (typeof previousDraft.title === "string" && typeof previousDraft.body === "string") {
          draft = {
            title: previousDraft.title,
            body: plainTextToHtml(previousDraft.body),
          };
          migrated = true;
        }
      }
    }

    if (draft) {
      if (typeof draft.title === "string") titleInput.value = draft.title;
      if (typeof draft.body === "string") bodyInput.innerHTML = draft.body;
      if (typeof draft.publishedId === "string") publishedDraftId = draft.publishedId;
      if (typeof draft.authorId === "string") selectedAuthorId = draft.authorId;
    }
    if (authors.some((author) => author.id === selectedAuthorId)) {
      authorSelect.value = selectedAuthorId;
    } else {
      selectedAuthorId = DEFAULT_AUTHOR.id;
      authorSelect.value = selectedAuthorId;
    }
    document.querySelector("#selected-author-name").textContent = getSelectedAuthor().name;
    updateStats();
    if (migrated) saveDraft();
  } catch (error) {
    showToast("Your saved draft could not be loaded.");
    console.error("Unable to load draft.", error);
  } finally {
    if (database) database.close();
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function cleanImportedHtml(html) {
  const allowedTags = new Set([
    "P", "BR", "STRONG", "B", "EM", "I", "U", "H1", "H2", "H3",
    "BLOCKQUOTE", "UL", "OL", "LI", "IMG", "A",
  ]);
  const parsed = new DOMParser().parseFromString(html, "text/html");

  function cleanNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const tag = node.tagName;
    if (tag === "IMG") {
      const source = node.getAttribute("src") || "";
      if (!/^data:image\/(png|jpeg|gif|webp|bmp);base64,/i.test(source)) return null;
      const image = document.createElement("img");
      image.src = source;
      image.alt = node.getAttribute("alt") || "";
      if (node.style.marginLeft === "auto") image.style.marginLeft = "auto";
      if (node.style.marginRight === "auto") image.style.marginRight = "auto";
      return image;
    }

    if (!allowedTags.has(tag)) {
      const contents = document.createDocumentFragment();
      node.childNodes.forEach((child) => {
        const cleanChild = cleanNode(child);
        if (cleanChild) contents.append(cleanChild);
      });
      return contents;
    }

    const element = document.createElement(tag.toLowerCase());
    if (tag === "P" || tag === "H1" || tag === "H2" || tag === "H3" || tag === "BLOCKQUOTE") {
      const alignment = node.style.textAlign;
      if (["left", "center", "right", "justify"].includes(alignment)) {
        element.style.textAlign = alignment;
      }
    }
    if (tag === "A") {
      const link = node.getAttribute("href") || "";
      if (/^(https?:|mailto:)/i.test(link)) {
        element.href = link;
        element.rel = "noopener noreferrer";
      }
    }
    node.childNodes.forEach((child) => {
      const cleanChild = cleanNode(child);
      if (cleanChild) element.append(cleanChild);
    });
    return element;
  }

  const result = document.createElement("div");
  parsed.body.childNodes.forEach((node) => {
    const cleanNodeResult = cleanNode(node);
    if (cleanNodeResult) result.append(cleanNodeResult);
  });
  return result.innerHTML;
}

function openPreview() {
  const title = titleInput.value.trim() || "Untitled draft";
  const words = getWordCount(bodyInput.innerText);
  const author = getSelectedAuthor();
  document.querySelector("#preview-byline").textContent =
    `${author.name.toUpperCase()} · ${Math.max(1, Math.ceil(words / 200))} MIN READ`;
  document.querySelector("#preview-title").textContent = title;
  document.querySelector("#preview-content").innerHTML = bodyInput.innerHTML;
  previewDialog.showModal();
}

async function readStore(storeName, key) {
  const database = await openDatabase();
  try {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

function writePublishedPost(post) {
  return openDatabase().then((database) =>
    new Promise((resolve, reject) => {
      const transaction = database.transaction(["drafts", "published"], "readwrite");
      transaction.objectStore("drafts").put(
        {
          title: post.title,
          body: bodyInput.innerHTML,
          publishedId: post.id,
          authorId: post.authorId,
        },
        "current",
      );
      transaction.objectStore("published").put(post, post.id);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    }),
  );
}

async function publishStory() {
  const title = titleInput.value.trim();
  const body = cleanImportedHtml(bodyInput.innerHTML);
  const author = getSelectedAuthor();
  if (!title) {
    showToast("Add a title before publishing.");
    titleInput.focus();
    return;
  }
  if (!bodyInput.innerText.trim()) {
    showToast("Write some story text before publishing.");
    bodyInput.focus();
    return;
  }

  const nameInput = document.querySelector("#submission-name");
  const emailInput = document.querySelector("#submission-email");
  const photoInput = document.querySelector("#submission-photo");
  const name = nameInput.value.trim();
  const email = emailInput.value.trim().toLowerCase();
  if (!name || !emailInput.validity.valid) {
    showToast("Enter your name and a valid email address to submit.");
    (name ? emailInput : nameInput).focus();
    return;
  }
  if (!supabaseClient) {
    showToast("Story submissions are not configured yet. Please try again later.");
    console.error("Supabase is not configured. Set the project URL and public anon key in supabase-config.js.");
    return;
  }
  const photoFile = photoInput.files[0];
  if (photoFile && !["image/png", "image/jpeg", "image/webp"].includes(photoFile.type)) {
    showToast("Choose a PNG, JPG, or WebP profile photo.");
    return;
  }
  if (photoFile && photoFile.size > 1024 * 1024) {
    showToast("Choose a profile photo smaller than 1 MB.");
    return;
  }

  try {
    window.clearTimeout(saveTimer);
    let photoUrl = "";
    if (photoFile) {
      const extension = photoFile.type === "image/png" ? "png" : photoFile.type === "image/webp" ? "webp" : "jpg";
      const photoPath = `${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabaseClient.storage
        .from("story-photos")
        .upload(photoPath, photoFile, { contentType: photoFile.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabaseClient.storage.from("story-photos").getPublicUrl(photoPath);
      photoUrl = data.publicUrl;
    }
    const { error } = await supabaseClient.rpc("submit_story", {
      story_title: title,
      story_body: body,
      contributor_name: name,
      contributor_email: email,
      contributor_photo_url: photoUrl,
    });
    if (error) throw error;
    titleInput.value = "";
    bodyInput.replaceChildren();
    nameInput.value = "";
    emailInput.value = "";
    photoInput.value = "";
    publishedDraftId = null;
    updateStats();
    window.location.hash = "submitted";
  } catch (error) {
    showToast("Your story could not be submitted. Please try again.");
    console.error("Unable to submit story for review.", error);
  }
}

function createPostCard(post) {
  const card = document.createElement("article");
  card.className = "published-card story-tile";
  const link = document.createElement("a");
  link.className = "story-tile-link";
  link.href = `#read/${encodeURIComponent(post.id)}`;
  link.setAttribute("aria-label", `Read ${post.title}`);

  const byline = document.createElement("div");
  byline.className = "story-tile-byline";
  const avatar = document.createElement("span");
  avatar.className = "story-avatar";
  if (post.contributor_photo_url) {
    const photo = document.createElement("img");
    photo.src = post.contributor_photo_url;
    photo.alt = "";
    photo.loading = "lazy";
    avatar.append(photo);
  } else {
    avatar.textContent = (post.authorName || "W").trim().charAt(0).toUpperCase();
  }
  const author = document.createElement("span");
  author.textContent = post.authorName || "Guest writer";
  byline.append(avatar, author);
  const title = document.createElement("h2");
  title.textContent = post.title;
  const date = document.createElement("span");
  date.textContent = new Date(post.created_at || post.publishedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const readTime = document.createElement("span");
  const content = new DOMParser().parseFromString(post.body, "text/html").body.textContent;
  const words = post.word_count || post.wordCount || getWordCount(content);
  readTime.textContent = `${Math.max(1, Math.ceil(words / 200))} min read`;
  const metadata = document.createElement("div");
  metadata.className = "story-tile-meta";
  metadata.append(date, readTime);
  link.append(byline, title, metadata);
  card.append(link);
  return card;
}

async function showPublishedPosts() {
  const list = document.querySelector("#published-list");
  list.replaceChildren();
  if (!supabaseClient) {
    showStoriesEmpty("The journal is being set up. Please check back soon.");
    document.querySelector("#published-count").textContent = "";
    return;
  }
  try {
    const { data: posts, error } = await supabaseClient
      .from("stories")
      .select("id,title,body,author_name,contributor_photo_url,created_at,word_count")
      .eq("status", "approved")
      .order("created_at", { ascending: false });
    if (error) throw error;
    document.querySelector("#published-count").textContent = posts.length;
    if (!posts.length) {
      showStoriesEmpty("There are no published stories yet. Be the first to share one.");
      return;
    }
    posts.forEach((post) => list.append(createPostCard({ ...post, authorName: post.author_name })));
  } catch (error) {
    showStoriesEmpty("Stories couldn’t be loaded. Please refresh the page to try again.");
    console.error("Unable to load approved stories.", error);
  }
}

function showStoriesEmpty(message) {
  const empty = document.createElement("div");
  empty.className = "published-empty";
  const heading = document.createElement("h2");
  heading.textContent = "A good story starts somewhere.";
  const description = document.createElement("p");
  description.textContent = message;
  const link = document.createElement("a");
  link.className = "button button-publish";
  link.href = "#editor";
  link.textContent = "Write a blog";
  empty.append(heading, description, link);
  document.querySelector("#published-list").replaceChildren(empty);
}

async function updatePublishedCount() {
  if (window.location.hash.slice(1) !== "home" && window.location.hash.slice(1) !== "") return;
  await showPublishedPosts();
}

async function showReader(postId) {
  try {
    let post;
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from("stories")
        .select("id,title,body,author_name,contributor_photo_url,created_at,status")
        .eq("id", postId)
        .eq("status", "approved")
        .maybeSingle();
      if (error) throw error;
      if (data) {
        post = {
          ...data,
          authorName: data.author_name,
          authorPhoto: data.contributor_photo_url,
          publishedAt: data.created_at,
        };
      }
    }
    if (!post) {
      showToast("That published story could not be found.");
      window.location.hash = "published";
      return;
    }
    let author = {
      name: post.authorName || DEFAULT_AUTHOR.name,
      bio: post.authorBio || (post.authorName ? "Writer and contributor to this blog." : DEFAULT_AUTHOR.bio),
      photo: post.authorPhoto || "",
    };
    if (post.authorId) {
      const savedAuthor = await readStore("authors", post.authorId);
      if (savedAuthor) author = savedAuthor;
    }
    if (!author.bio) author.bio = "Writer and contributor to this blog.";
    document.querySelector("#reader-title").textContent = post.title;
    document.querySelector("#reader-byline").textContent =
      `${author.name.toUpperCase()} · ${new Date(post.publishedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).toUpperCase()}`;
    document.querySelector("#reader-content").innerHTML = cleanImportedHtml(post.body);
    document.querySelector("#reader-author-name").textContent = author.name;
    document.querySelector("#reader-author-bio").textContent = author.bio;
    updateAuthorAvatar(document.querySelector("#reader-author-avatar"), author);
    if (post.authorPhoto) {
      const photo = document.createElement("img");
      photo.src = post.authorPhoto;
      photo.alt = "";
      document.querySelector("#reader-author-avatar").replaceChildren(photo);
    }
  } catch (error) {
    showToast("That published story could not be opened.");
    console.error("Unable to open published story.", error);
    window.location.hash = "published";
  }
}

function renderAdminSubmissions(rows) {
  pendingList.replaceChildren();
  pendingList.hidden = false;
  document.querySelector("#admin-login").hidden = true;
  document.querySelector("#admin-signout").hidden = false;
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "library-intro";
    empty.textContent = "There are no submissions waiting for review.";
    pendingList.append(empty);
    return;
  }
  rows.forEach((row) => {
    const card = document.createElement("article");
    card.className = "published-card moderation-card";
    const title = document.createElement("h2");
    title.textContent = row.title;
    const byline = document.createElement("p");
    byline.className = "published-author";
    byline.textContent = `By ${row.author_name} · ${row.contact_email} · ${new Date(row.created_at).toLocaleDateString()}`;
    const body = document.createElement("div");
    body.className = "moderation-content";
    body.innerHTML = cleanImportedHtml(row.body);
    const actions = document.createElement("div");
    actions.className = "moderation-actions";
    ["approved", "rejected"].forEach((status) => {
      const button = document.createElement("button");
      button.className = status === "approved" ? "button button-publish" : "button button-quiet";
      button.type = "button";
      button.textContent = status === "approved" ? "Approve and publish" : "Reject";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const { error } = await supabaseClient.rpc("review_story", {
            story_id: row.id,
            new_status: status,
          });
          if (error) throw error;
          await loadAdminSubmissions();
          showToast(status === "approved" ? "Story approved and published." : "Submission rejected.");
        } catch (error) {
          button.disabled = false;
          showToast("The submission could not be updated.");
          console.error("Unable to review story.", error);
        }
      });
      actions.append(button);
    });
    card.append(title, byline, body, actions);
    pendingList.append(card);
  });
}

async function loadAdminSubmissions() {
  if (!supabaseClient) {
    document.querySelector("#admin-login-status").textContent =
      "The review system is not configured yet. Please contact the site administrator.";
    return;
  }
  const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError) {
    console.error("Unable to check editor sign-in.", sessionError);
    document.querySelector("#admin-login-status").textContent = "Editor sign-in could not be checked.";
    return;
  }
  window.adminAuthenticated = Boolean(ADMIN_USER_ID && session && session.user.id === ADMIN_USER_ID);
  document.querySelector("#admin-signout").hidden = !window.adminAuthenticated;
  document.querySelector("#admin-nav-link").hidden = !window.adminAuthenticated;
  if (!window.adminAuthenticated) {
    document.querySelector("#admin-login").hidden = false;
    pendingList.hidden = true;
    if (session && ADMIN_USER_ID) {
      document.querySelector("#admin-login-status").textContent =
        "This Supabase account is not authorized to review submissions.";
    }
    return;
  }
  document.querySelector("#admin-login").hidden = true;
  pendingList.hidden = false;
  const { data, error } = await supabaseClient.rpc("list_pending_stories");
  if (error) {
    showToast("Pending submissions could not be loaded.");
    console.error("Unable to load pending stories.", error);
    return;
  }
  renderAdminSubmissions(data || []);
}

document.querySelector("#admin-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#admin-email").value.trim().toLowerCase();
  const status = document.querySelector("#admin-login-status");
  if (!supabaseClient) {
    status.textContent = "The review system is not configured yet.";
    return;
  }
  if (!ADMIN_USER_ID) {
    status.textContent = "The editor account is not configured yet.";
    return;
  }
  status.textContent = "Sending a secure sign-in link…";
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) {
    status.textContent = "A sign-in link could not be sent. Please try again.";
    console.error("Unable to send editor sign-in link.", error);
    return;
  }
  status.textContent = "Check your email for a secure sign-in link.";
});

document.querySelector("#admin-signout").addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    showToast("You could not be signed out.");
    console.error("Unable to sign out editor.", error);
    return;
  }
  window.adminAuthenticated = false;
  await loadAdminSubmissions();
});

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange(() => {
    if (window.location.hash.slice(1) === "admin") {
      window.setTimeout(loadAdminSubmissions, 0);
    }
  });
}

function updatePage() {
  const hash = window.location.hash.slice(1) || "home";
  const isHome = hash === "home" || hash === "published";
  const isReader = hash.startsWith("read/");
  const isEditor = hash === "editor";
  const isAuthors = hash === "authors";
  const isAdmin = hash === "admin";
  const isSubmitted = hash === "submitted";
  homePage.hidden = !isHome;
  editorPage.hidden = !isEditor;
  publishedPage.hidden = !isAdmin;
  authorsPage.hidden = !isAuthors;
  readerPage.hidden = !isReader;
  submissionConfirmation.hidden = !isSubmitted;
  document.querySelector(".app-shell").classList.toggle("reader-mode", isReader);
  document.querySelector(".app-shell").classList.toggle("public-mode", isHome || isReader);
  document.querySelectorAll("[data-route-link]").forEach((link) => {
    link.classList.toggle(
      "active",
      link.dataset.routeLink === (isAdmin ? "admin" : isEditor ? "write" : "home"),
    );
  });

  if (isHome) showPublishedPosts();
  document.querySelector("#admin-nav-link").hidden = !isAdmin && !window.adminAuthenticated;
  if (isAdmin) loadAdminSubmissions();
  if (isAuthors) refreshAuthors().catch((error) => {
    showToast("Author profiles could not be loaded.");
    console.error("Unable to load author profiles.", error);
  });
  if (isReader) showReader(decodeURIComponent(hash.slice("read/".length)));
  if (isHome || isEditor || isAdmin || isSubmitted) window.scrollTo(0, 0);
}

async function importWordDocument(file) {
  if (!file.name.toLowerCase().endsWith(".docx")) {
    showToast("Please choose a Word .docx file.");
    return;
  }
  if (!window.mammoth) {
    showToast("The Word importer could not load. Check your internet connection and try again.");
    return;
  }
  if ((titleInput.value || bodyInput.innerText.trim()) &&
      !window.confirm("Replace the current draft with this Word document?")) {
    return;
  }

  try {
    const result = await window.mammoth.convertToHtml(
      { arrayBuffer: await file.arrayBuffer() },
      {
        convertImage: window.mammoth.images.inline((image) =>
          image.read("base64").then((imageData) => ({
            src: `data:${image.contentType};base64,${imageData}`,
          })),
        ),
      },
    );
    bodyInput.innerHTML = cleanImportedHtml(result.value);
    titleInput.value = file.name.replace(/\.docx$/i, "").replace(/[_-]+/g, " ").slice(0, 120);
    updateStats();
    saveDraft();
    showToast("Imported. Select an image to align it; complex layouts may need adjustment.");
    if (result.messages.length) {
      console.info("Some Word document formatting was not imported.", result.messages);
    }
  } catch (error) {
    showToast("Could not read that Word document. Please check the file and try again.");
    console.error("Unable to import Word document.", error);
  }
}

titleInput.addEventListener("input", () => {
  updateStats();
  saveDraft();
});

document.querySelector("#submission-name").addEventListener("input", (event) => {
  document.querySelector("#selected-author-name").textContent =
    event.currentTarget.value.trim() || "Your name";
});

bodyInput.addEventListener("input", () => {
  if (!bodyInput.contains(selectedImage)) selectedImage = null;
  updateStats();
  saveDraft();
});

document.querySelector("#preview-button").addEventListener("click", openPreview);
document.querySelector("#import-button").addEventListener("click", () => wordFile.click());
authorSelect.addEventListener("change", () => {
  selectedAuthorId = authorSelect.value;
  document.querySelector("#selected-author-name").textContent = getSelectedAuthor().name;
  saveDraft();
});

authorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.querySelector("#author-name").value.trim();
  const bio = document.querySelector("#author-bio").value.trim();
  const photoFile = document.querySelector("#author-photo").files[0];
  if (!name) {
    showToast("Enter the author's name.");
    return;
  }
  if (photoFile && !["image/png", "image/jpeg", "image/webp"].includes(photoFile.type)) {
    showToast("Choose a PNG, JPG, or WebP photo.");
    return;
  }
  if (photoFile && photoFile.size > 2 * 1024 * 1024) {
    showToast("Choose a photo smaller than 2 MB.");
    return;
  }

  try {
    const isEditing = Boolean(editingAuthorId);
    const author = {
      id: editingAuthorId || `author-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      bio,
      photo: photoFile ? await readPhoto(photoFile) : editingAuthorPhoto,
    };
    await saveAuthor(author);
    await refreshAuthors();
    selectedAuthorId = author.id;
    authorSelect.value = author.id;
    resetAuthorForm();
    saveDraft();
    showToast(isEditing ? "Author profile updated." : "Author added.");
  } catch (error) {
    showToast("That author profile could not be saved.");
    console.error("Unable to save author profile.", error);
  }
});

document.querySelector("#cancel-author-edit").addEventListener("click", resetAuthorForm);

wordFile.addEventListener("change", () => {
  if (wordFile.files[0]) importWordDocument(wordFile.files[0]);
  wordFile.value = "";
});
document.querySelector("#close-preview").addEventListener("click", () => previewDialog.close());

previewDialog.addEventListener("click", (event) => {
  if (event.target === previewDialog) previewDialog.close();
});

document.querySelector("#publish-button").addEventListener("click", publishStory);

document.querySelector("#prompt-button").addEventListener("click", () => {
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];
  bodyInput.insertAdjacentHTML("beforeend", `<p>${prompt}</p>`);
  bodyInput.focus();
  updateStats();
  saveDraft();
});

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => {
    bodyInput.focus();
    document.execCommand(button.dataset.command, false, button.dataset.value || null);
    updateStats();
    saveDraft();
  });
});

bodyInput.addEventListener("click", (event) => {
  if (selectedImage) selectedImage.classList.remove("selected-image");
  selectedImage = event.target.closest("img");
  if (selectedImage) selectedImage.classList.add("selected-image");
});

document.querySelectorAll("[data-image-align]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!selectedImage) {
      showToast("Select an image in your story first.");
      return;
    }
    selectedImage.style.display = "block";
    selectedImage.style.marginLeft =
      button.dataset.imageAlign === "right" ? "auto" : button.dataset.imageAlign === "center" ? "auto" : "0";
    selectedImage.style.marginRight =
      button.dataset.imageAlign === "left" ? "auto" : button.dataset.imageAlign === "center" ? "auto" : "0";
    saveDraft();
  });
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveDraft();
  }
});

window.addEventListener("hashchange", updatePage);

async function startApp() {
  await loadAuthors();
  await loadDraft();
  updateStats();
  updatePage();
}

startApp();
