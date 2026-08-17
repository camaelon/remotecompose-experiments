package androidx.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.SOURCE)
public @interface RestrictTo { Scope[] value(); enum Scope { LIBRARY_GROUP, LIBRARY, TESTS, SUBCLASSES } }
