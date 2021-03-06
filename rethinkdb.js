"use strict";
var util = require('util');
var fs = require('fs');
var path = require('path');
var config = require("@nodulus/config");
var assert = require('assert');
class dal {
    mongoOperator(key) {
        var ops = {
            "=": "$eq",
            "!=": "$ne",
            ">": "$gt",
            ">=": "$gte",
            "<": "$lt",
            "<=": "$lte",
            "in": "$in"
        };
        if (ops[key] === undefined)
            return key;
        return ops[key];
    }
    parse(str, params) {
        var res = { queryMode: null, collection: "", where: {}, values: {}, limit: 0 };
        var x = str.split(" ");
        res.queryMode = x[0].trim();
        if (x[2] == "SET") {
            res.values = { "$set": {} };
            var pairs = str.substring(str.indexOf("SET") + 3).split(",");
            for (var j = 0; j < pairs.length; j++) {
                var triple = pairs[j].split("=");
                res.values["$set"][triple[0].trim()] = params[triple[0].trim()];
            }
        }
        for (var i = 0; i < x.length; i++) {
            if (x[i] == "UPDATE")
                res.collection = x[i + 1];
            if (x[i] == "FROM")
                res.collection = x[i + 1];
            if (x[i] == "INTO") {
                res.collection = x[i + 1];
                res.values = params;
            }
            if (x[i] == "WHERE") {
                var conditionPoint = res.where;
                if (res.queryMode != "UPDATE") {
                    conditionPoint["$query"] = {};
                    conditionPoint = conditionPoint["$query"];
                }
                var pairs = str.substring(str.indexOf("WHERE") + 6).split("AND");
                for (var j = 0; j < pairs.length; j++) {
                    var triple = pairs[j].split("@");
                    if (triple.length < 2)
                        continue;
                    var cleankey = triple[1].replace(';', '').trim();
                    if (cleankey === "$limit")
                        res.limit = params[cleankey];
                    var operator = this.mongoOperator(triple[0].replace(cleankey, '').trim());
                    if (operator !== "^^") {
                        conditionPoint[cleankey] = {};
                        conditionPoint[cleankey][operator] = params[cleankey];
                        if (params[cleankey] == "false")
                            conditionPoint[cleankey][operator] = false;
                        if (params[cleankey] == "true")
                            conditionPoint[cleankey][operator] = true;
                    }
                    else {
                        res.where[cleankey] = params[cleankey];
                    }
                }
            }
        }
        return res;
    }
    getAll(callback) {
        var url = config.appSettings.database.mongodb.host;
        var Db = require('mongodb').Db;
        var Server = require('mongodb').Server;
        var db = new Db('scripter', new Server('localhost', 27017));
        db.open(function (err, db1) {
            assert.equal(null, err);
            db.collections(function (err, items) {
                assert.ok(items.length > 0);
                var fitems = [];
                for (var i = 0; i < items.length; i++) {
                    fitems.push(items[i].s.name);
                }
                callback(fitems);
            });
        });
    }
    getCollection(name, callback) {
        this.query("SELECT * FROM " + name, {}, callback);
    }
    getSingle(name, id, callback) {
        this.connect(function (err, db) {
            assert.equal(null, err);
            var url = config.appSettings.database.mongodb.host;
            db.collection(name).findOne({ "_id": id }, function (err, doc) {
                if (err !== null || doc === null)
                    callback({ "error": "not found" });
                else
                    callback(doc);
            });
        });
    }
    connect(callback) {
        if (!this.db || this.db === null) {
            var db = require('rethinkdbdash')(require('./templates/config.js').servers);
            this.db = db;
            db.listCollections = function (result) {
                var tableList = db.tableList();
                tableList.toArray = function (callback) {
                    tableList.run(function (err, results) {
                        callback(null, results.map(function (item) { return { name: item }; }));
                    });
                };
                return tableList;
            };
            db.collection = function (collectionName) {
                var table = db.table(collectionName);

                table.ensureIndex = function () { };
                table.find = function (filter) {
                    var actualFilter = filter;
                    for (var key in filter) {
                        switch (key) {
                            case "$query":
                                actualFilter = filter[key];
                                break;
                        }
                    }
                    var f = table.filter(actualFilter);

                    f.toArray = f.run;

                    var skip = f.skip;
                    f.skip = function (skipValue) {
                        var f = table.skip(skipValue);
                        f.toArray = f.run;
                        return f;
                    };


                    return f;
                };
                table.save = function (value, callback) {
                    table.insert(value).run(function (err, results) {
                        callback(err, results);
                    });
                };
                return table;
            };
            callback(null, db);
        }
        else {
            callback(null, this.db);
        }
    }
    saveSchema(name, schema, callback) {
        this.query("INSERT INTO schemas name=@name, schema=@schema", { "name": name, "schema": schema }, callback);
    }
    getSchema(name, callback) {
        this.query("SELECT * FROM schemas WHERE name=@name", { "name": name }, callback);
    }
    deleteCollection(collection, id, callback) {
        var url = config.appSettings.database.mongodb.host;
        var MongoClient = require('mongodb').MongoClient;
        this.connect(function (err, db) {
            assert.equal(null, err);
            db.collection(collection).findAndRemove({ "id": id }, function (err, doc) {
                assert.equal(null, err);
                callback(doc);
            });
        });
    }
    addToSet(id, collection, propertyName, pushObject, callback) {
        this.connect(function (err, db) {
            assert.equal(null, err);
            var pusher = {};
            pusher[propertyName] = pushObject;
            db.collection(collection).update({ _id: id }, { $addToSet: pusher }, function (err, data) {
                callback(data);
            });
        });
    }
    pushObject(id, collection, propertyName, pushObject, callback) {
        this.connect(function (err, db) {
            assert.equal(null, err);
            var pusher = {};
            pusher[propertyName] = pushObject;
            db.collection(collection).update({ _id: id }, { $push: pusher }, function (err, data) {
                callback(data);
            });
        });
    }
    pullObject(id, collection, propertyName, pullObject, callback) {
        this.connect(function (err, db) {
            assert.equal(null, err);
            var puller = {};
            puller[propertyName] = pullObject;
            db.collection(collection).update({ _id: id }, { $pull: puller }, function (err, data) {
                callback(data);
            });
        });
    }
    getSet(idArr, collection, callback) {
        if (typeof (idArr) == "string")
            idArr = [idArr];
        this.connect(function (err, db) {
            assert.equal(null, err);
            db.collection(collection).find({ _id: { "$in": idArr } }).toArray(function (err, data) {
                callback(data);
            });
        });
    }
    query(queryStr, params, callback) {
        var oQuery = this.parse(queryStr, params);
        this.connect(function (err, db) {
            assert.equal(null, err);
            switch (oQuery.queryMode) {
                case "INSERT":
                    if (!oQuery.values["_id"]) {
                    }
                    db.collection(oQuery.collection).save(oQuery.values, function (err, result) {
                        assert.equal(err, null);
                        console.log("inserted document from " + oQuery.collection);
                        callback(result);
                    });
                    break;
                case "DELETE":
                    db.collection(oQuery.collection).remove(oQuery.where["$query"], function (err, result) {
                        assert.equal(err, null);
                        console.log("deleted document from " + oQuery.collection);
                        callback(result);
                    });
                    break;
                case "UPDATE":
                    db.collection(oQuery.collection).update(oQuery.where, oQuery.values, function (err, result) {
                        assert.equal(err, null);
                        console.log("updated document from " + oQuery.collection);
                        var cursor = db.collection(oQuery.collection).find(oQuery.where);
                        var retArr = [];
                        cursor.each(function (err, doc) {
                            assert.equal(err, null);
                            if (doc != null) {
                                retArr.push(doc);
                            }
                            else {
                                callback(retArr);
                            }
                        });
                    });
                    break;
                case "SELECT":
                    var retArr = [];
                    var cursor;
                    var whereFlag = false;
                    for (var i in oQuery.where)
                        whereFlag = true;
                    if (whereFlag) {
                        cursor = db.collection(oQuery.collection).find(oQuery.where);
                    }
                    else
                        cursor = db.collection(oQuery.collection).find();
                    if (oQuery.limit === undefined)
                        oQuery.limit = 0;
                    cursor.limit(oQuery.limit).each(function (err, doc) {
                        assert.equal(err, null);
                        if (doc != null) {
                            retArr.push(doc);
                        }
                        else {
                            callback(retArr);
                        }
                    });
                    break;
            }
        });
    }
    sendToArchive(data, res) {
    }
    get(entity, searchCommand, specialCommand, aggregateCommand, callback) {
        this.connect(function (err, db) {
            if (db === null) {
                return callback(err);
            }
            db.collection(entity).ensureIndex({ "$**": "text" }, { name: "TextIndex" });
            if (specialCommand.$skip && specialCommand.$limit) {
                db.collection(entity).find(searchCommand.$query).count(function (err, countResult) {
                    db.collection(entity).find(searchCommand, aggregateCommand.$project).skip(Number(specialCommand.$skip)).limit(Number(specialCommand.$limit)).toArray(function (err, result) {
                        var data = { items: result, count: countResult };
                        callback(data);
                    });
                });
            }
            else {
                if (searchCommand.$query && searchCommand.$query["_id"]) {
                }
                db.collection(entity).find(searchCommand).toArray(function (err, result) {
                    var data = { items: result !== null ? result : [], count: result !== null ? result.length : 0 };
                    return callback(data);
                });
            }
        });
    }
}
exports.dal = dal;
