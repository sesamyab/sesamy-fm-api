import jwt from "jsonwebtoken";

const payload = {
  sub: "user-123",
  scopes: ["podcast.read", "podcast.write", "podcast.publish"],
  iss: "https://auth2.sesamy.dev",
  aud: "podcast-service",
  exp: Math.floor(Date.now() / 1000) + 3600 * 24,
  iat: Math.floor(Date.now() / 1000),
};

const secret = process.env.JWT_SECRET || "your-secret-key";
const token = jwt.sign(payload, secret);

console.log("Generated test JWT token:");
console.log(token);
console.log("");
console.log("Use this token in the Authorization header:");
console.log(`Authorization: Bearer ${token}`);
