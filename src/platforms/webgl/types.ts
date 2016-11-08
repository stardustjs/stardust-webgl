let typeName2WebGLTypeName: { [ name: string ]: string } = {
    "float": "float",
    "int": "int",
    "bool": "bool",
    "Vector2": "vec2",
    "Vector3": "vec3",
    "Vector4": "vec4",
    "Quaternion": "vec4",
    "Color": "vec4"
};

export function convertTypeName(name: string): string {
    return typeName2WebGLTypeName[name];
}

export function convertConstant(type: string, value: number | number[]): string {
    if(type == "float") {
        return (value as number).toFixed(5);
    }
    if(type == "int") {
        return (value as number).toString();
    }
    if(type == "bool") {
        return (value as number) != 0 ? "true" : "false";
    }
    if(type == "Vector2") {
        return "vec2(" + (value as number[]).join(", ") + ")";
    }
    if(type == "Vector3") {
        return "vec3(" + (value as number[]).join(", ") + ")";
    }
    if(type == "Vector4") {
        return "vec4(" + (value as number[]).join(", ") + ")";
    }
    if(type == "Color") {
        return "vec4(" + (value as number[]).join(", ") + ")";
    }
}