// netlify/functions/addBook.js

const fetch = require('node-fetch');

exports.handler = async function (event, context) {
  console.log("=== addBook function invoked ===");

  // 1. Only allow POST requests
  if (event.httpMethod !== 'POST') {
    console.error("Method not allowed: Received", event.httpMethod);
    return {
      statusCode: 405,
      body: JSON.stringify({ message: 'Method Not Allowed, use POST.' })
    };
  }

  // 2. Parse the incoming POST body
  let bodyData;
  try {
    console.log("Parsing request body...");
    bodyData = JSON.parse(event.body);
    console.log("Parsed body:", bodyData);
  } catch (err) {
    console.error("JSON parse error:", err);
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Invalid JSON in request body' })
    };
  }

  // *** Extract the submitted password plus your other fields ***
  const {
    secretPassword,
    title,
    author,
    description,
    readDate,
    quoteRasmus,
    quoteHenry,
    quoteAndre,
    coverFileBase64,
    coverFileName
  } = bodyData;

  // *** Compare secretPassword to our server-side env var ***
  if (secretPassword !== process.env.ADMIN_PASSWORD) {
    console.error("Unauthorized: incorrect password");
    return {
      statusCode: 401,
      body: JSON.stringify({
        success: false,
        message: 'Unauthorized: incorrect password'
      })
    };
  }

  // 3. Validate minimum fields
  if (!title || !author || !coverFileBase64 || !coverFileName) {
    console.error("Missing required fields:", {
      title,
      author,
      coverFileBase64: Boolean(coverFileBase64),
      coverFileName
    });
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: 'Missing required fields: title, author, coverFileBase64, coverFileName'
      })
    };
  }

  // 4. Prepare GitHub variables
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const owner = 'RasmusKoRiis';
  const repo = 'book';
  const branch = 'main';

  console.log("GITHUB_TOKEN present?", !!GITHUB_TOKEN);
  console.log("owner:", owner, "repo:", repo, "branch:", branch);

  // Helpers -------------------------

  async function getBooksJson() {
    console.log("Fetching books.json from GitHub...");
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/books.json`,
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`
        }
      }
    );
    console.log("books.json fetch status:", res.status);

    if (!res.ok) {
      const text = await res.text();
      console.error("Failed to fetch books.json. Response text:", text);
      throw new Error(`Failed to fetch books.json from GitHub (status ${res.status})`);
    }

    const data = await res.json();
    console.log("books.json fetch success:", data);

    const decoded = Buffer.from(data.content, 'base64').toString();
    const books = JSON.parse(decoded);
    console.log("Parsed existing books:", books);

    return { books, sha: data.sha };
  }

  async function updateBooksJson(updatedBooks, fileSha) {
    console.log("Updating books.json with new books array...");
    const newContent = Buffer.from(JSON.stringify(updatedBooks, null, 2)).toString('base64');

    const putRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/books.json`,
      {
        method: 'PUT',
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Add new book: ${title}`,
          content: newContent,
          sha: fileSha,
          branch
        })
      }
    );
    console.log("PUT /books.json status:", putRes.status);

    if (!putRes.ok) {
      const errText = await putRes.text();
      console.error("Failed to update books.json:", errText);
      throw new Error(`Failed to update books.json on GitHub (status ${putRes.status})`);
    }

    const json = await putRes.json();
    console.log("books.json update success:", json);
    return json;
  }

  async function uploadCoverImage(base64File, fileName) {
    console.log(`Uploading cover image: ${fileName} ...`);
    const filePath = `assets/${Date.now()}-${fileName}`;

    const uploadRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Add cover image: ${fileName}`,
          content: base64File,
          branch
        })
      }
    );
    console.log("PUT /assets/ status:", uploadRes.status);

    if (!uploadRes.ok) {
      const uploadErrText = await uploadRes.text();
      console.error("Failed to upload cover image:", uploadErrText);
      throw new Error(`Failed to upload cover image to GitHub (status ${uploadRes.status})`);
    }

    const uploadData = await uploadRes.json();
    console.log("Cover image upload success:", uploadData);

    return {
      coverUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${uploadData.content.path}`
    };
  }

  // Main logic inside try/catch
  try {
    console.log("1) Uploading the cover file...");
    const { coverUrl } = await uploadCoverImage(coverFileBase64, coverFileName);

    console.log("2) Fetching current books.json...");
    const { books, sha } = await getBooksJson();

    console.log("3) Create new book object");
    const newBook = {
      title,
      author,
      description,
      readDate,
      quoteRasmus,
      quoteHenry,
      quoteAndre,
      cover: coverUrl
    };
    console.log("New book:", newBook);

    console.log("4) Append to existing books...");
    books.push(newBook);

    console.log("5) Update books.json (commit)...");
    await updateBooksJson(books, sha);

    console.log("6) Return success. Done!");
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Book added successfully!',
        coverUrl
      })
    };
  } catch (error) {
    console.error('Error in addBook function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: error.message })
    };
  }
};