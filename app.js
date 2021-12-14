const express = require("express");
const bodyParser = require("body-parser");
var jsrsasign = require("jsrsasign");
var crypto = require("crypto");
const https = require("https");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql");
const e = require("express");
const { userInfo } = require("os");
const app = express();
//encode takes two paramaters: key (utf8), data (utf8)
const sslServer = https.createServer(
  {
    key: fs.readFileSync(path.join(__dirname, "cert", "key.pem")),
    cert: fs.readFileSync(path.join(__dirname, "cert", "cert.pem")),
  },
  app
);
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "payment",
});

db.connect((err) => {
  if (err) {
    throw err;
  }
});

app.use(bodyParser.json());

app.set("view-engine", "ejs");

app.get("/register", (req, res) => {
  res.render("register.ejs");
});

function checkUserBiometricInfo() {
  return true;
  //just assume that the materials uploaded by user are exactly valid, legal and correct
}
app.post("/register", (req, res) => {
  const verifier = crypto.createVerify("sha1WithRSAEncryption");
  verifier.update(req.body.str);
  isSigValid = verifier.verify(req.body.pubkey, req.body.sign, "base64");
  if (isSigValid == true) {
    userinfo = JSON.parse(req.body.str);
    salt = crypto.randomBytes(16).toString("hex");
    processedPwd = hex_xor(userinfo.pwd, salt);
    if (checkUserBiometricInfo() == false) {
      res.statusCode = 500;
      console.log("register failed! Invalid materials");
      str = JSON.stringify({
        status: "register failed! Invalid materials",
        time: +new Date(),
      });
      sig = sign(str, "./cert/key.pem");
      res.send({ str: str, sig: sig });
      return;
    }
    let post = {
      salt: salt,
      password: processedPwd,
      phone: "12345678",
      voucherAmount: 5000,
      pubkey: escapeSQL(req.body.pubkey),
      userID: escapeSQL(userinfo.userID),
    };
    sql = "INSERT into users SET ?";
    query = db.query(sql, post, (err, result) => {
      if (err) {
        res.statusCode = 500;
        console.log("register failed due to system error!");
        str = JSON.stringify({
          status: "register failed due to system error!",
          time: +new Date(),
        });
        sig = sign(str, "./cert/key.pem");
        res.send({ str: str, sig: sig });
        return;
      }
      console.log("new user if=", result.insertId);
      res.statusCode = 200;
      sigID = sign(result.insertId, "./cert/key.pem");
      res.send({ str: result.insertId, sig: sigID });
    });
  } else {
    res.statusCode = 403;
    console.log("Invalid signature!");
    str = JSON.stringify({
      status: "Invalid signature!",
      time: +new Date(),
    });
    sig = sign(str, "./cert/key.pem");
    res.send({ str: str, sig: sig });
    return;
  }
});

app.use(express.static(__dirname));

app.get("/payment", (req, res) => {
  res.render("payment.ejs");
});

app.get("/shop", (req, res) => {
  res.render("merchant.ejs");
});

app.post("/bill", (req, res) => {
  timenow = +new Date();
  console.log("bill request received on ", timenow);
  const verifier = crypto.createVerify("sha1WithRSAEncryption");
  userinfo = JSON.parse(req.body.str);
  let sql = "SELECT * FROM users WHERE id=" + mysql.escape(userinfo.userID);
  pubkey = "";
  let query = db.query(sql, (err, result) => {
    if (err) {
      res.statusCode = 500;
      str = JSON.stringify({
        status: "System error, try later",
        time: +new Date(),
      });
      sig = sign(str, "./cert/key.pem");
      res.send({ str: str, sig: sig });
      return;
    }
    pubkey = result[0].pubkey;
    verifier.update(req.body.str);
    isSigValid = verifier.verify(pubkey, req.body.sign, "base64");
    if (isSigValid == true) {
      if (timenow - parseInt(userinfo.time) > 30000) {
        res.statusCode = 403;
        console.log("Outdated packet");
        str = JSON.stringify({
          status: "Outdated packet",
          time: +new Date(),
        });
        sig = sign(str, "./cert/key.pem");
        res.send({ str: str, sig: sig });
        return;
      } else {
        console.log("waiting for bills");
        let post = {
          user_id: userinfo.userID,
        };
        let sql = "INSERT into billsession SET ?";
        sessionID = "";
        query = db.query(sql, post, (err, result) => {
          if (err) {
            let sql = `DELETE FROM billsession WHERE user_id=${mysql.escape(
              userinfo.userID
            )}`;
            db.query(sql, () => {});
            res.statusCode = 500;
            str = JSON.stringify({
              status:
                "Session already set up, this is due to unexpected system error, please regenerate qr code",
              time: +new Date(),
            });
            sig = sign(str, "./cert/key.pem");
            res.send({ str: str, sig: sig });
            return;
          }
          sessionID = result.insertId;
          console.log("new session id = " + result.insertId);
          finalresult = {};
          sql = `SELECT * FROM billsession WHERE user_id=${mysql.escape(
            userinfo.userID
          )}`;
          count = 0;
          var dbcheck = setInterval(function () {
            result = [];
            getInformationFromDB(sql, result, function (err, resp) {
              if (err) {
                let sql = `DELETE FROM billsession WHERE user_id=${mysql.escape(
                  userinfo.userID
                )}`;
                db.query(sql, () => {});
                res.statusCode = 500;
                console.log("System error, please repress get-qrcode");
                str = JSON.stringify({
                  status: "System error, please repress get-qrcode",
                  time: +new Date(),
                });
                sig = sign(str, "./cert/key.pem");
                res.send({ str: str, sig: sig });
                return;
              }
              //console.log(res[0]); // returns undefined
              if (resp[0] == undefined) {
                res.statusCode = 408;
                console.log("Session expired, please repress get-qrcode");
                str = JSON.stringify({
                  status: "Session expired, please repress get-qrcode",
                  time: +new Date(),
                });
                sig = sign(str, "./cert/key.pem");
                res.send({ str: str, sig: sig });
                return;
              }
              console.log(resp[0].status);
              if (resp[0].status == "valid") {
                finalresult = resp[0];
                console.log(finalresult);
                clearInterval(dbcheck);
                res.statusCode = 200;
                billtext = JSON.stringify({
                  shopname: escapeHTML("Wastons"),
                  shopid: escapeHTML(finalresult.shop_id),
                  amount: escapeHTML(finalresult.amount),
                });
                console.log();
                billsig = sign(billtext, "./cert/key.pem");
                res.send({
                  str: billtext,
                  sig: billsig,
                });
              } else if (count >= 60) {
                console.log("Payment session expired");
                let sql =
                  "DELETE FROM billsession WHERE id=" + mysql.escape(sessionID);
                db.query(sql, post, () => {});
                clearInterval(dbcheck);
                res.statusCode = 408;
                str = JSON.stringify({
                  status: "Payment session expired",
                  time: +new Date(),
                });
                sig = sign(str, "./cert/key.pem");
                res.send({ str: str, sig: sig });
                return;
              }
              count++;
            });
          }, 1000);
        });
      }
    } else {
      console.log("Invalid signature");
      res.statusCode = 403;
      str = JSON.stringify({
        status: "Invalid signature",
        time: +new Date(),
      });
      sig = sign(str, "./cert/key.pem");
      res.send({ str: str, sig: sig });
      return;
    }
  });
});
app.post("/newbill", (req, res) => {
  console.log("Here is an example of preventing sql injection: ");
  console.log(
    "SELECT * FROM shops WHERE id=" +
      mysql.escape("10'; DELETE FROM shops WHERE id='123")
  );
  billinfo = JSON.parse(req.body.str);
  let sql = "SELECT * FROM shops WHERE id=" + mysql.escape(billinfo.shopid);
  console.log(sql);
  pubkey = "";
  let query = db.query(sql, (err, shopentity) => {
    if (err) {
      res.statusCode = 404;
      console.log("Shop entity not found!");
      str = JSON.stringify({
        status: "Shop entity not found!",
        time: +new Date(),
      });
      sig = sign(str, "./cert/key.pem");
      res.send({ str: str, sig: sig });
      return;
    }
    pubkey = shopentity[0].pubkey;
    const verifier = crypto.createVerify("sha1WithRSAEncryption");
    verifier.update(req.body.str);
    isSigValid = verifier.verify(pubkey, req.body.sign, "base64");
    if (isSigValid == true) {
      console.log("Shop validated!");
      userinfo = JSON.parse(billinfo.purchaser);
      console.log("Here is the payer's encrypted info");
      console.log(userinfo);
      if (userinfo.str != undefined) {
        //prototype offline payment
        userAttr = JSON.parse(userinfo.str);
        try {
          userID = decrypt(userAttr.userID, "./cert/key.pem");
          console.log("a offline payment from user  id=", userID);
        } catch (err) {
          res.statusCode = 403;
          console.log("Cannot decrypt userID");
          str = JSON.stringify({
            status: "Cannot decrypt userID",
            time: +new Date(),
          });
          sig = sign(str, "./cert/key.pem");
          res.send({ str: str, sig: sig });
          return;
        }
        let sql = "SELECT * FROM users WHERE id=" + mysql.escape(userID);
        db.query(sql, (err, result) => {
          if (err || result.length == 0) {
            res.statusCode = 404;
            console.log("Unregistered User");
            str = JSON.stringify({
              status: "Unregister User",
              time: +new Date(),
            });
            sig = sign(str, "./cert/key.pem");
            res.send({ str: str, sig: sig });
            return;
          } else {
            pubkey = result[0].pubkey;
            const verifier = crypto.createVerify("sha1WithRSAEncryption");
            verifier.update(userinfo.str);
            isSigValid = verifier.verify(pubkey, userinfo.sig, "base64");
            if ((isSigValid = true)) {
              console.log('User Validated');
              timeNow = +new Date(); 
              if (timeNow - parseInt(userAttr.time) > 60000) {
                res.statusCode = 403;
                console.log("failure, qrcode expired")
                str = JSON.stringify({
                  status: "failure, qrcode expired", //invalid signature
                  time: +new Date(),
                });
                sig = sign(str, "./cert/key.pem");
                res.send({ str: str, sig: sig });
                return;
              }
              if(parseInt(result[0].lastPaidTime)==userAttr.time){
                res.statusCode = 403;
                console.log("failure, reusage of qrcode")
                str = JSON.stringify({
                  status: "failure, reusage of qrcode", //invalid signature
                  time: +new Date(),
                });
                sig = sign(str, "./cert/key.pem");
                res.send({ str: str, sig: sig });
                return;
              }
              required = JSON.parse(req.body.str).price;
              if (result[0].voucherAmount >= required) {
                let sql2 = `UPDATE users SET voucherAmount=voucherAmount-${required}, lastPaidTime=${mysql.escape(userAttr.time)} WHERE id=${userID}`;
                db.query(sql2, () => {});
                res.statusCode = 200;
                console.log("payment success!");
                str = JSON.stringify({
                  status: "success",
                  time: +new Date(),
                });
                sig = sign(str, "./cert/key.pem");
                res.send({ str: str, sig: sig });
                return;
              }else{
                res.statusCode = 403;
                console.log("failure, not enough voucher");
                str = JSON.stringify({
                  status: "failure, not enough voucher",
                  time: +new Date(),
                });
                sig = sign(str, "./cert/key.pem");
                res.send({ str: str, sig: sig });
                return;
              }
            } else {
              console.log("Fake user information, invalid signature"); //invalid user signature
              res.statusCode = 403;
              str = JSON.stringify({
                status: "Fake user information, invalid signature",
                time: +new Date(),
              });
              sig = sign(str, "./cert/key.pem");
              res.send({ str: str, sig: sig });
              return;
            }
          }
        });
      } else {
        try {
          userID = decrypt(userinfo.userID, "./cert/key.pem");
        } catch (err) {
          res.statusCode = 403;
          console.log("Cannot decrypt userID");
          str = JSON.stringify({
            status: "Cannot decrypt userID",
            time: +new Date(),
          });
          sig = sign(str, "./cert/key.pem");
          res.send({ str: str, sig: sig });
          return;
        }
        console.log("User is ID=", userID);
        let sql = "SELECT * FROM users WHERE id=" + mysql.escape(userID);
        db.query(sql, (err, result) => {
          if (err || result.length == 0) {
            res.statusCode = 404;
            console.log("Unregistered User");
            str = JSON.stringify({
              status: "Unregister User",
              time: +new Date(),
            });
            sig = sign(str, "./cert/key.pem");
            res.send({ str: str, sig: sig });
            return;
          } else {
            pubkey = result[0].pubkey;
            const verifier = crypto.createVerify("sha1WithRSAEncryption");
            verifier.update(userinfo.userID);
            isSigValid = verifier.verify(pubkey, userinfo.sig, "base64");
            if ((isSigValid = true)) {
              console.log("user validated");
              let sql = `UPDATE billsession SET shop_id=${
                billinfo.shopid
              },amount=${
                billinfo.price
              }, status='valid' WHERE user_id=${mysql.escape(userID)}`;
              let query = db.query(sql, (err, result) => {
                if (err) {
                  res.statusCode = 500;
                  console.log("Cannot update user session");
                  str = JSON.stringify({
                    status: "Cannot update user session",
                    time: +new Date(),
                  });
                  sig = sign(str, "./cert/key.pem");
                  res.send({ str: str, sig: sig });
                  return;
                }
                let sqlpaycheck = `SELECT * FROM billsession WHERE user_id=${mysql.escape(
                  userID
                )}`;
                count = 0;
                var dbcheck = setInterval(function () {
                  result = [];
                  getInformationFromDB(
                    sqlpaycheck,
                    result,
                    function (err, resp) {
                      if (err) {
                        res.statusCode = 500;
                        console.log("Error in fetching bill session");
                        str = JSON.stringify({
                          status: "Error in fetching bill session",
                          time: +new Date(),
                        });
                        sig = sign(str, "./cert/key.pem");
                        res.send({ str: str, sig: sig });
                        clearInterval(dbcheck);
                        return;
                      }
                      //console.log(resp[0]); // returns undefined
                      if (resp[0] == undefined) {
                        console.log("User session not exist");
                        str = JSON.stringify({
                          status: "User session not exist",
                          time: +new Date(),
                        });
                        sig = sign(str, "./cert/key.pem");
                        res.send({ str: str, sig: sig });
                        clearInterval(dbcheck);
                        return;
                      }
                      if (resp[0].status == "topay") {
                        console.log("Payment succeeded!");
                        finalresult = resp[0];
                        clearInterval(dbcheck);
                        res.statusCode = 200;
                        let sql = `DELETE FROM billsession WHERE user_id=${mysql.escape(
                          userID
                        )}`;
                        db.query(sql, () => {});
                        res.statusCode = 200;
                        str = JSON.stringify({
                          status: "success",
                          time: +new Date(),
                        });
                        sig = sign(str, "./cert/key.pem");
                        res.send({ str: str, sig: sig });
                      } else if (resp[0].status == "unset") {
                        console.log("Payment failed!");
                        finalresult = resp[0];
                        clearInterval(dbcheck);
                        res.statusCode = 200;
                        let sql = `DELETE FROM billsession WHERE user_id=${mysql.escape(
                          userID
                        )}`;
                        db.query(sql, post, () => {});
                        res.statusCode = 403;
                        str = JSON.stringify({
                          status: "failure",
                          time: +new Date(),
                        });
                        sig = sign(str, "./cert/key.pem");
                        res.send({ str: str, sig: sig });
                      } else if (count > 200) {
                        console.log("Payment timeout!");
                        clearInterval(dbcheck);
                        res.statusCode = 200;
                        let sql = `DELETE FROM billsession WHERE user_id=${mysql.escape(
                          userID
                        )}`;
                        db.query(sql, () => {});
                        res.statusCode = 403;
                        str = JSON.stringify({
                          status: "failure, timeout",
                          time: +new Date(),
                        });
                        sig = sign(str, "./cert/key.pem");
                        res.send({ str: str, sig: sig });
                      }
                      count++;
                    }
                  );
                }, 1000);
              });
            } else {
              console.log("Fake user information, invalid signature"); //invalid user signature
              res.statusCode = 403;
              str = JSON.stringify({
                status: "Fake user information, invalid signature",
                time: +new Date(),
              });
              sig = sign(str, "./cert/key.pem");
              res.send({ str: str, sig: sig });
              return;
            }
          }
        });
      }
    } else {
      res.statusCode = 403;
      console.log("Shop sigature not validated ! Fake information");
      str = JSON.stringify({
        status: "Shop sigature not validated ! Fake information",
        time: +new Date(),
      });
      sig = sign(str, "./cert/key.pem");
      res.send({ str: str, sig: sig });
      return;
    }
  });
});

app.post("/pay", (req, res) => {
  userinfo = JSON.parse(req.body.str);
  userID = userinfo.userID;
  let sql = `SELECT * FROM users WHERE id=${mysql.escape(userinfo.userID)}`;
  console.log(sql);
  pubkey = "";
  result = [];
  getInformationFromDB(sql, result, function (err, resp) {
    if (err) {
      let sql = "DELETE FROM billsession";
      db.query(sql, post, () => {});
      throw err;
    }
    pubkey = resp[0].pubkey;
    salt = resp[0].salt;
    givenPassword = resp[0].password;
    const verifier = crypto.createVerify("sha1WithRSAEncryption");
    verifier.update(req.body.str);
    isSigValid = verifier.verify(pubkey, req.body.sig, "base64");
    if (isSigValid == true) {
      timeNow = +new Date();
      if (timenow - parseInt(userinfo.time) > 30000) {
        res.statusCode = 403;
        str = JSON.stringify({
          status: "failure, message from a long time ago, maybe csrf attack",
          time: +new Date(),
        });
        sig = sign(str, "./cert/key.pem");
        res.send({ str: str, sig: sig });
        return;
      }
      result = [];
      let sqlbill = `SELECT * FROM billsession WHERE user_id=${mysql.escape(
        userID
      )}`;
      getInformationFromDB(sqlbill, result, function (err, resp) {
        if (err) {
          let sql = "DELETE FROM billsession";
          db.query(sql, post, () => {});
          throw err;
        }
        billAmount = resp[0].amount;
        sessionID = resp[0].id;
        console.log("session ID is ", sessionID);
        if (resp[0] == undefined) {
          res.statusCode = 403;
          str = JSON.stringify({
            status: "failure, session expired",
            time: +new Date(),
          });
          sig = sign(str, "./cert/key.pem");
          res.send({ str: str, sig: sig });
          return;
        }
        processedPwd = hex_xor(decrypt(userinfo.pwd, "./cert/key.pem"), salt);
        if (processedPwd.localeCompare(givenPassword) == 0) {
          console.log("Password verified for user " + userinfo.userID);
          userAcct = resp[0].voucherAmount;
          if (
            makePayment(
              userAcct,
              billAmount,
              sessionID,
              mysql.escape(userID)
            ) == true
          ) {
            res.statusCode = 200;
            str = JSON.stringify({ status: "success", time: +new Date() });
            sig = sign(str, "./cert/key.pem");
            res.send({ str: str, sig: sig });
          } else {
            res.statusCode = 403;
            str = JSON.stringify({
              status: "failure, not enough voucher",
              time: +new Date(),
            });
            sig = sign(str, "./cert/key.pem");
            res.send({ str: str, sig: sig });
            return;
          }
        } else {
          res.statusCode = 403;
          str = JSON.stringify({
            status: "failure, wrong password",
            time: +new Date(),
          });
          sig = sign(str, "./cert/key.pem");
          res.send({ str: str, sig: sig });
        }
      });
    } else {
      res.statusCode = 403;
      str = JSON.stringify({
        status: "failure, message broken", //invalid signature
        time: +new Date(),
      });
      sig = sign(str, "./cert/key.pem");
      res.send({ str: str, sig: sig });
    }
  });
});

//Listening
sslServer.listen(3000, () => console.log("secure server on 3000"));

function hex_xor(a, b) {
  result = "";
  for (var i = 0; i < a.length; i++) {
    temp = parseInt(a.charAt(i), 16) ^ parseInt(b.charAt(i), 16);
    result += temp.toString(16);
  }
  return result;
}
function decrypt(toDecrypt, pathtoPrivateKey) {
  const absolutePath = path.resolve(pathtoPrivateKey);
  const privateKey = fs.readFileSync(absolutePath, "utf8");
  keyobj = jsrsasign.KEYUTIL.getKey(privateKey);
  decrypted = jsrsasign.KJUR.crypto.Cipher.decrypt(toDecrypt, keyobj);
  return decrypted;
}
function sign(toSign, pathtoPrivateKey) {
  const absolutePath = path.resolve(pathtoPrivateKey);
  const privateKey = fs.readFileSync(absolutePath, "utf8");
  var sig = new jsrsasign.KJUR.crypto.Signature({
    alg: "SHA1withRSA",
    prvkeypem: privateKey,
  });
  sig.updateString(toSign);
  let temp = sig.sign();
  let sign = jsrsasign.hextob64(temp);
  return sign;
}
var getInformationFromDB = function (sql, result, callback) {
  db.query(sql, function (err, res, fields) {
    if (err) return callback(err);
    if (res.length) {
      for (var i = 0; i < res.length; i++) {
        result.push(res[i]);
      }
    }
    callback(null, result);
  });
};
function escapeHTML(s) {
  return s
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeSQL(s) {
  return s.toString().replace(/'/g, "\\'");
}

function makePayment(remain, required, sessionID, userID) {
  if (remain < required) {
    let sql = `UPDATE billsession SET status='unset' WHERE id=${sessionID}`;
    db.query(sql, () => {});
    return false;
  } else {
    let sql = `UPDATE billsession SET status='topay' WHERE id=${sessionID}`;
    db.query(sql, () => {});
    let sql2 = `UPDATE users SET voucherAmount=voucherAmount-${required} WHERE id=${userID}`;
    db.query(sql2, () => {});
    return true;
  }
}
