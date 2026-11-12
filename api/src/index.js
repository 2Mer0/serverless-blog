// Azure Functions entry point. Loads every function file in src/functions.
require("./functions/GetPosts");
require("./functions/GetPostById");
require("./functions/CreatePost");
require("./functions/DeletePost");
require("./functions/AdminListPosts");
require("./functions/AdminListBans");
require("./functions/AdminBanUser");
require("./functions/AdminUnbanUser");
require("./functions/WhoAmI");
require("./functions/UploadImage");
require("./functions/ProbeAlpha");
require("./functions/ProbeAdmin");
